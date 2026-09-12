import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Trip, TripStatus } from '../../database/entities/trip.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Booking, BookingStatus, PARTICIPANT_BOOKING_STATUSES } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { TripComment } from '../../database/entities/trip-comment.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { SearchTripsDto } from './dto/search-trips.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { BlocksService } from '../blocks/blocks.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { KashierService } from '../payments/kashier.service';

// Matches the app's date picker. See assertDepartureTimeInRange — this needs to drop
// inside Kashier's authorization hold window before online payments can be relied on.
const MAX_TRIP_LEAD_DAYS = 90;

@Injectable()
export class TripsService {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(TripComment)
    private readonly commentRepo: Repository<TripComment>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly blocksService: BlocksService,
    private readonly kashier: KashierService,
  ) {}

  async create(driver: User, dto: CreateTripDto): Promise<Trip> {
    if (!driver.driverVerified) {
      throw new ForbiddenException('Driver must complete vehicle verification before posting trips');
    }

    if (driver.status === UserStatus.SUSPENDED || driver.status === UserStatus.BANNED) {
      throw new ForbiddenException('حسابك موقوف. يرجى التواصل مع الدعم.');
    }

    if (driver.tripPostingBannedUntil && driver.tripPostingBannedUntil > new Date()) {
      const until = driver.tripPostingBannedUntil.toLocaleDateString('ar-EG');
      throw new ForbiddenException(`تم تعليق حقك في نشر الرحلات حتى ${until} بسبب الإلغاء المتكرر`);
    }

    const canPost = await this.subscriptionsService.canUserPostTrip(driver.id);
    if (!canPost) {
      throw new ForbiddenException('يجب الاشتراك في النسخة المدفوعة لنشر الرحلات');
    }

    this.assertDepartureTimeInRange(dto.departureTime);

    const trip = this.tripRepo.create({
      ...dto,
      driverId: driver.id,
      availableSeats: dto.totalSeats,
      departureTime: new Date(dto.departureTime),
      womenOnly: dto.womenOnly ?? false,
      smokingAllowed: dto.smokingAllowed ?? false,
      petsAllowed: dto.petsAllowed ?? false,
      airConditioning: dto.airConditioning ?? false,
      luggageSize: dto.luggageSize ?? 'medium',
      chatPreference: dto.chatPreference ?? 'friendly',
    });

    return this.tripRepo.save(trip);
  }

  // The app's date picker caps departure at 90 days, but that is client-side only —
  // a direct API call could post a trip years out, or in the past (which the scheduler
  // would then auto-cancel and strike the driver for).
  //
  // MAX_TRIP_LEAD_DAYS must end up inside Kashier's authorization hold window (7 or 30
  // days, per account configuration): a hold is placed when the passenger books, and
  // capture only happens at trip completion, so a longer lead time lets the hold lapse
  // before the money is taken. Lower this once Kashier confirms the window.
  private assertDepartureTimeInRange(value: Date | string): void {
    const departure = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(departure.getTime())) {
      throw new BadRequestException('تاريخ المغادرة غير صالح');
    }
    if (departure.getTime() <= Date.now()) {
      throw new BadRequestException('لا يمكن نشر رحلة في الماضي');
    }
    const maxLeadMs = MAX_TRIP_LEAD_DAYS * 24 * 60 * 60 * 1000;
    if (departure.getTime() - Date.now() > maxLeadMs) {
      throw new BadRequestException(
        `لا يمكن نشر رحلة بعد أكثر من ${MAX_TRIP_LEAD_DAYS} يوم من الآن`,
      );
    }
  }

  async search(dto: SearchTripsDto, currentUser: User) {
    const date = new Date(dto.departureDate);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Block filtering: exclude trips from drivers I blocked, and drivers who blocked me
    const [blockedByMe, usersWhoBlockedMe] = await Promise.all([
      this.blocksService.getBlockedIds(currentUser.id),
      this.blocksService.getBlockerIds(currentUser.id),
    ]);
    const excludedDriverIds = [...new Set([...blockedByMe, ...usersWhoBlockedMe])];

    const qb = this.tripRepo
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.driver', 'driver')
      .where('LOWER(trip.originCity) = LOWER(:origin)', { origin: dto.originCity })
      .andWhere('LOWER(trip.destinationCity) = LOWER(:destination)', { destination: dto.destinationCity })
      .andWhere('trip.departureTime BETWEEN :start AND :end', { start: startOfDay, end: endOfDay })
      .andWhere('trip.status = :status', { status: TripStatus.SCHEDULED })
      .andWhere('trip.availableSeats >= :seats', { seats: dto.seats ?? 1 });

    if (excludedDriverIds.length > 0) {
      qb.andWhere('trip.driverId NOT IN (:...excludedDriverIds)', { excludedDriverIds });
    }

    if (dto.womenOnly) {
      qb.andWhere('trip.womenOnly = true');
      qb.andWhere('driver.gender = :gender', { gender: 'female' });
    }

    if (dto.smokingAllowed !== undefined) {
      qb.andWhere('trip.smokingAllowed = :smoking', { smoking: dto.smokingAllowed });
    }

    if (dto.petsAllowed !== undefined) {
      qb.andWhere('trip.petsAllowed = :pets', { pets: dto.petsAllowed });
    }

    if (dto.maxPrice) {
      qb.andWhere('trip.pricePerSeat <= :maxPrice', { maxPrice: dto.maxPrice });
    }

    qb.orderBy('trip.departureTime', 'ASC');

    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? 20, 50);
    qb.skip((page - 1) * limit).take(limit);

    const [trips, total] = await qb.getManyAndCount();

    return {
      data: trips.map((t) => this.formatTrip(t)),
      total,
      page,
      limit,
    };
  }

  /** Full entity, including the driver's private columns. Internal callers only. */
  async findById(id: string): Promise<Trip> {
    const trip = await this.tripRepo.findOne({
      where: { id },
      relations: { driver: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  /**
   * What the trip-detail endpoint returns. Returning the raw entity handed every
   * viewer the driver's national ID number and photo, emergency contacts and FCM
   * token — formatTrip narrows it to the same public fields search already uses.
   */
  async findByIdPublic(id: string) {
    return this.formatTrip(await this.findById(id));
  }

  async cancel(tripId: string, driver: User, reason?: string): Promise<Trip> {
    const paymentsToRefund: string[] = [];

    const saved = await this.dataSource.transaction(async (manager) => {
      const trip = await manager.findOne(Trip, { where: { id: tripId } });
      if (!trip) throw new NotFoundException('Trip not found');
      if (trip.driverId !== driver.id) {
        throw new ForbiddenException('You can only cancel your own trips');
      }
      if (trip.status !== TripStatus.SCHEDULED) {
        throw new BadRequestException('Only scheduled trips can be cancelled');
      }

      // Cancel & refund ALL active bookings — confirmed, pending approval, and pending payment
      const bookings = await manager.find(Booking, {
        where: [
          { tripId, status: BookingStatus.CONFIRMED },
          { tripId, status: BookingStatus.PENDING_DRIVER_APPROVAL },
          { tripId, status: BookingStatus.PENDING_PAYMENT },
        ],
        relations: { payment: true },
      });

      const passengerIds: string[] = [];
      for (const booking of bookings) {
        // Payment state is deliberately left alone here. Kashier has to be called to
        // actually return the money, and a network call inside this transaction would
        // hold locks — and could leave the DB claiming REFUNDED when nothing moved.
        // Collected now, settled after the transaction commits.
        if (booking.payment && !booking.payment.isCash) {
          paymentsToRefund.push(booking.payment.id);
        }
        booking.status = BookingStatus.REFUNDED;
        booking.cancelledAt = new Date();
        booking.cancellationReason = 'تم إلغاء الرحلة من قِبل السائق';
        await manager.save(Booking, booking);
        passengerIds.push(booking.passengerId);
      }

      trip.status = TripStatus.CANCELLED;
      trip.cancelledAt = new Date();
      trip.cancellationReason = reason ?? '';
      const saved = await manager.save(Trip, trip);

      // Notify all affected passengers
      if (passengerIds.length > 0) {
        setImmediate(() => {
          void this.notifications.sendToUsers(passengerIds, {
            title: 'تم إلغاء الرحلة',
            body: `رحلة ${trip.originCity} → ${trip.destinationCity} تم إلغاؤها من قِبل السائق. سيتم استرداد مبلغك كاملاً.`,
            data: { tripId, screen: 'my_bookings' },
          });
        });
      }

      return saved;
    });

    await this.returnFundsForPayments(paymentsToRefund, `trip ${tripId} cancelled by driver`);

    return saved;
  }

  /**
   * Actually returns passengers' money for cancelled bookings: a hold that was only
   * authorized is voided, a captured payment is refunded in full. Runs after the
   * cancelling transaction has committed, so the seats are freed even if the gateway is
   * unreachable — a payment that fails here keeps its current status and is logged, so
   * it stays visible for a retry rather than being recorded as refunded regardless.
   */
  private async returnFundsForPayments(paymentIds: string[], context: string): Promise<void> {
    if (paymentIds.length === 0) return;

    const payments = await this.paymentRepo.findBy({ id: In(paymentIds) });
    for (const payment of payments) {
      if (payment.isCash) continue;
      const orderId = payment.gatewayTransactionId ?? payment.gatewayOrderId;
      if (!orderId) continue;

      try {
        if (payment.status === PaymentStatus.PENDING) {
          await this.kashier.releasePayment(orderId, payment.kashierTransactionId ?? undefined);
          payment.status = PaymentStatus.RELEASED;
          payment.releasedAt = new Date();
        } else if (payment.status === PaymentStatus.CAPTURED) {
          await this.kashier.refundPayment(orderId, Number(payment.amount));
          payment.status = PaymentStatus.REFUNDED;
          payment.refundAmount = Number(payment.amount);
          payment.refundedAt = new Date();
        } else {
          continue;
        }
        await this.paymentRepo.save(payment);
      } catch (err) {
        this.logger.error(
          `Failed to return funds for payment ${payment.id} (${context}, status ${payment.status}): ${err}`,
        );
      }
    }
  }

  async startTrip(tripId: string, driver: User): Promise<Trip> {
    const trip = await this.findById(tripId);
    if (trip.driverId !== driver.id) throw new ForbiddenException('Not your trip');
    if (trip.status !== TripStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled trips can be started');
    }

    const confirmedBookings = await this.bookingRepo.find({
      where: { tripId, status: BookingStatus.CONFIRMED },
    });

    trip.status = TripStatus.ACTIVE;
    await this.tripRepo.save(trip);

    if (confirmedBookings.length > 0) {
      await this.bookingRepo.update(
        confirmedBookings.map((b) => b.id),
        { status: BookingStatus.IN_PROGRESS },
      );

      const passengerIds = confirmedBookings.map((b) => b.passengerId);
      const route = `${trip.originCity} ← ${trip.destinationCity}`;
      setImmediate(() =>
        void this.notifications.sendToUsers(passengerIds, {
          title: '🚗 رحلتك بدأت!',
          body: `السائق بدأ رحلة ${route}. تتبع موقعه من التطبيق.`,
          data: { screen: 'trip_detail', tripId: trip.id },
        }),
      );
    }

    return trip;
  }

  async updateTrip(tripId: string, driver: User, dto: Partial<Trip>): Promise<Trip> {
    const trip = await this.findById(tripId);
    if (trip.driverId !== driver.id) throw new ForbiddenException('Not your trip');
    if (trip.status !== TripStatus.SCHEDULED) {
      throw new BadRequestException('Only scheduled trips can be edited');
    }
    if (dto.totalSeats !== undefined && dto.totalSeats < (trip.totalSeats - trip.availableSeats)) {
      throw new BadRequestException('Cannot reduce seats below already-booked count');
    }
    if (dto.departureTime !== undefined) {
      this.assertDepartureTimeInRange(dto.departureTime);
    }
    Object.assign(trip, dto);
    if (dto.totalSeats !== undefined) {
      trip.availableSeats = dto.totalSeats - (trip.totalSeats - trip.availableSeats);
    }
    return this.tripRepo.save(trip);
  }

  async markComplete(tripId: string, driver: User): Promise<Trip> {
    const trip = await this.findById(tripId);

    if (trip.driverId !== driver.id) {
      throw new ForbiddenException('You can only complete your own trips');
    }

    if (trip.status !== TripStatus.ACTIVE && trip.status !== TripStatus.SCHEDULED) {
      throw new BadRequestException('Trip cannot be marked as complete in its current state');
    }

    const paymentsToCaptureIds: string[] = [];
    const completedPassengerIds: string[] = [];

    const saved = await this.dataSource.transaction(async (manager) => {
      trip.status = TripStatus.COMPLETED;
      trip.completedAt = new Date();
      const result = await manager.save(trip);

      // Load active bookings (CONFIRMED or IN_PROGRESS) with payments before bulk update
      const confirmedBookings = await manager.find(Booking, {
        where: [
          { tripId, status: BookingStatus.CONFIRMED },
          { tripId, status: BookingStatus.IN_PROGRESS },
        ],
        relations: { payment: true },
      });
      completedPassengerIds.push(...confirmedBookings.map((b) => b.passengerId));

      // Mark PENDING (authorized) payments as CAPTURED in DB
      for (const booking of confirmedBookings) {
        if (
          booking.payment &&
          !booking.payment.isCash &&
          booking.payment.status === PaymentStatus.PENDING
        ) {
          booking.payment.status = PaymentStatus.CAPTURED;
          booking.payment.capturedAt = new Date();
          await manager.save(Payment, booking.payment);
          paymentsToCaptureIds.push(booking.payment.id);
        }
      }

      await manager.update(
        Booking,
        [
          { tripId, status: BookingStatus.CONFIRMED },
          { tripId, status: BookingStatus.IN_PROGRESS },
        ],
        { status: BookingStatus.TRIP_COMPLETED, completedAt: new Date() },
      );

      await manager
        .createQueryBuilder()
        .update('users')
        .set({ completedTripsAsDriver: () => 'completed_trips_as_driver + 1' })
        .where('id = :driverId', { driverId: driver.id })
        .execute();

      return result;
    });

    // After DB transaction: call Kashier capture for each payment (non-blocking)
    if (paymentsToCaptureIds.length > 0) {
      setImmediate(async () => {
        const payments = await this.paymentRepo.findBy({ id: In(paymentsToCaptureIds) });
        for (const payment of payments) {
          const orderId = payment.gatewayTransactionId ?? payment.gatewayOrderId;
          try {
            await this.kashier.capturePayment(orderId, Number(payment.amount));
            this.logger.log(`Captured payment ${payment.id} (${payment.amount} EGP)`);
          } catch (e) {
            // The transaction already wrote CAPTURED optimistically. Ask Kashier what
            // actually happened before trusting it — keeping CAPTURED on an uncaptured
            // order would credit the driver for money we never took.
            const actual = await this.kashier.getPaymentStatus(payment.gatewaySessionId);
            if (actual === 'CAPTURED') {
              this.logger.warn(
                `Capture call failed for payment ${payment.id} but Kashier reports CAPTURED — keeping CAPTURED: ${String(e)}`,
              );
            } else {
              await this.paymentRepo.update(payment.id, { status: PaymentStatus.PENDING });
              this.logger.error(
                `Kashier capture failed for payment ${payment.id} (Kashier status: ${actual ?? 'unknown'}): ${String(e)}`,
              );
            }
          }
        }
      });
    }

    // Notify all passengers that the trip is complete
    if (completedPassengerIds.length > 0) {
      setImmediate(() => {
        for (const passengerId of completedPassengerIds) {
          void this.notifications.sendToUser(passengerId, {
            title: 'اكتملت الرحلة ✅',
            body: 'تم إنهاء الرحلة بنجاح. يمكنك الآن تقييم التجربة.',
            data: { tripId, screen: 'trip_detail' },
          });
        }
      });
    }

    return saved;
  }

  async getDriverTrips(driverId: string, status?: TripStatus): Promise<Trip[]> {
    const where: Partial<Trip> = { driverId };
    if (status) where.status = status;
    return this.tripRepo.find({ where, order: { departureTime: 'DESC' } });
  }

  async getBookingsForTrip(tripId: string, driver: User): Promise<(Booking & { hasRated: boolean })[]> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverId !== driver.id) throw new ForbiddenException('Not your trip');

    const bookings = await this.bookingRepo.find({
      where: { tripId },
      relations: { passenger: true },
      order: { createdAt: 'ASC' },
    });
    if (bookings.length === 0) return [];

    const bookingIds = bookings.map((b) => b.id);
    const ratedRows = await this.dataSource.query<Array<{ booking_id: string }>>(
      `SELECT booking_id FROM ratings WHERE rater_id = $1 AND booking_id = ANY($2)`,
      [driver.id, bookingIds],
    );
    const ratedSet = new Set(ratedRows.map((r) => r.booking_id));
    return bookings.map((b) => Object.assign(b, { hasRated: ratedSet.has(b.id) }));
  }

  async getComments(tripId: string): Promise<TripComment[]> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    return this.commentRepo.find({
      where: { tripId },
      relations: { user: true },
      order: { createdAt: 'ASC' },
    });
  }

  async addComment(tripId: string, user: User, body: string): Promise<TripComment> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    const comment = this.commentRepo.create({ tripId, userId: user.id, body });
    const saved = await this.commentRepo.save(comment);
    saved.user = user;

    const senderName = user.fullName || user.phoneNumber;
    const preview = body.length > 60 ? body.substring(0, 60) + '...' : body;
    if (trip.driverId !== user.id) {
      // Passenger posted — notify driver
      setImmediate(() => {
        void this.notifications.sendToUser(trip.driverId, {
          title: 'تعليق جديد على رحلتك',
          body: `${senderName}: ${preview}`,
          data: { tripId, screen: 'trip_detail' },
        });
      });
    } else {
      // Driver posted — notify all confirmed/in-progress passengers
      setImmediate(async () => {
        const passengerBookings = await this.bookingRepo.find({
          where: { tripId, status: In(PARTICIPANT_BOOKING_STATUSES) },
          select: { passengerId: true },
        });
        for (const b of passengerBookings) {
          void this.notifications.sendToUser(b.passengerId, {
            title: 'تعليق جديد على الرحلة',
            body: `السائق: ${preview}`,
            data: { tripId, screen: 'trip_detail' },
          });
        }
      });
    }

    return saved;
  }

  async getCoPassengers(tripId: string, user: User) {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');

    const isDriver = trip.driverId === user.id;
    if (!isDriver) {
      const booking = await this.bookingRepo.findOne({
        where: { tripId, passengerId: user.id, status: In(PARTICIPANT_BOOKING_STATUSES) },
      });
      if (!booking) throw new ForbiddenException('Not a participant on this trip');
    }

    const bookings = await this.bookingRepo.find({
      where: { tripId, status: In(PARTICIPANT_BOOKING_STATUSES) },
      relations: { passenger: true },
      order: { createdAt: 'ASC' },
    });

    return bookings
      .filter((b) => b.passengerId !== user.id)
      .map((b) => {
        const p = b.passenger;
        const firstName = (p.fullName || '').split(' ')[0] || 'راكب';
        return {
          id:                        p.id,
          firstName,
          gender:                    p.gender ?? null,
          profilePhotoUrl:           p.profilePhotoUrl ?? null,
          ratingAverage:             p.ratingAverage,
          ratingCount:               p.ratingCount,
          completedTripsAsPassenger: p.completedTripsAsPassenger,
          seatsCount:                b.seatsCount,
        };
      });
  }

  private formatTrip(trip: Trip) {
    const { driver, ...rest } = trip;
    return {
      ...rest,
      driver: driver
        ? {
            id: driver.id,
            fullName: driver.fullName,
            profilePhotoUrl: driver.profilePhotoUrl,
            ratingAverage: driver.ratingAverage,
            ratingCount: driver.ratingCount,
            completedTripsAsDriver: driver.completedTripsAsDriver,
            idVerified: driver.idVerified,
            driverVerified: driver.driverVerified,
            vehicleMake: driver.vehicleMake,
            vehicleModel: driver.vehicleModel,
            vehicleYear: driver.vehicleYear,
            vehicleColor: driver.vehicleColor,
          }
        : null,
    };
  }
}
