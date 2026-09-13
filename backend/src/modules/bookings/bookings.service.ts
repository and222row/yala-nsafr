import {
  Injectable,
  BadRequestException,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Booking, BookingStatus, PaymentMethod } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Trip, TripStatus } from '../../database/entities/trip.entity';
import { User, Gender } from '../../database/entities/user.entity';
import { ReferralReward } from '../../database/entities/referral-reward.entity';
import { Dispute, DisputeStatus } from '../../database/entities/dispute.entity';
import { PlatformConfig, CONFIG_KEYS } from '../../database/entities/platform-config.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { OpenDisputeDto } from '../admin/dto/open-dispute.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { KashierService } from '../payments/kashier.service';

// Auto-confirm 2 hours after departure time if no dispute
const AUTO_CONFIRM_HOURS = 2;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(PlatformConfig)
    private readonly configRepo: Repository<PlatformConfig>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly kashier: KashierService,
  ) {}

  private async getConfigNum(key: string, fallback: number): Promise<number> {
    const row = await this.configRepo.findOne({ where: { key } });
    return row ? parseFloat(row.value) : fallback;
  }

  /**
   * The cancellation thresholds the app must show before payment. Kashier's contract
   * requires a refund policy the customer can see and accept beforehand, and these are
   * admin-configurable — so they are read here rather than restated in the client.
   */
  async getCancellationPolicy() {
    const [freeCancelHours, lateCancelHours, lateCancelFeePct] = await Promise.all([
      this.getConfigNum(CONFIG_KEYS.FREE_CANCEL_HOURS, 48),
      this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_HOURS, 2),
      this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_FEE_PCT, 0.15),
    ]);
    return { freeCancelHours, lateCancelHours, lateCancelFeePct };
  }

  /** Read-only: calculate what the passenger would get back if they cancel now. */
  async getCancelPreview(bookingId: string, passenger: User) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: { trip: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.passengerId !== passenger.id) throw new ForbiddenException('Not your booking');

    const canCancel =
      booking.status === BookingStatus.CONFIRMED ||
      booking.status === BookingStatus.PENDING_DRIVER_APPROVAL;

    const isCash = booking.paymentMethod === PaymentMethod.CASH;
    const now = new Date();
    const hoursUntil =
      (booking.trip.departureTime.getTime() - now.getTime()) / 3_600_000;
    const tripStarted = booking.trip.status === TripStatus.ACTIVE ||
                        booking.trip.status === TripStatus.COMPLETED;

    const [freeCancelHours, lateCancelHours, lateCancelFeePct] = await Promise.all([
      this.getConfigNum(CONFIG_KEYS.FREE_CANCEL_HOURS, 48),
      this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_HOURS, 2),
      this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_FEE_PCT, 0.15),
    ]);

    const total = booking.totalAmount;
    let policy: 'free_cancel' | 'late_cancel' | 'no_refund';
    let refundAmount: number;
    let cancellationFee: number;

    if (!canCancel || tripStarted) {
      policy = 'no_refund';
      refundAmount = 0;
      cancellationFee = 0;
    } else if (isCash || hoursUntil >= freeCancelHours) {
      policy = 'free_cancel';
      refundAmount = total;
      cancellationFee = 0;
    } else if (hoursUntil >= lateCancelHours) {
      policy = 'late_cancel';
      cancellationFee = +(total * lateCancelFeePct).toFixed(2);
      refundAmount = +(total - cancellationFee).toFixed(2);
    } else {
      policy = 'no_refund';
      refundAmount = 0;
      cancellationFee = total;
    }

    return {
      canCancel: canCancel && !tripStarted && hoursUntil > 0,
      policy,
      hoursUntilDeparture: +hoursUntil.toFixed(1),
      totalAmount: total,
      refundAmount,
      cancellationFee,
      isCash,
    };
  }

  async create(passenger: User, dto: CreateBookingDto): Promise<Booking & { paymentUrl?: string }> {
    // Check if passenger is temporarily restricted from booking
    const freshPassenger = await this.dataSource.manager.findOne(User, {
      where: { id: passenger.id },
      select: { id: true, cashBookingRestrictedUntil: true },
    });
    if (
      freshPassenger?.cashBookingRestrictedUntil &&
      freshPassenger.cashBookingRestrictedUntil > new Date()
    ) {
      throw new BadRequestException(
        'أنت ممنوع مؤقتاً من حجز رحلات الكاش بسبب الإلغاء المتكرر',
      );
    }

    let driverId = '';
    let originCity = '';
    let destinationCity = '';

    const booking = await this.dataSource.transaction(async (manager) => {
      const trip = await manager.findOne(Trip, {
        where: { id: dto.tripId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!trip) throw new NotFoundException('Trip not found');
      driverId = trip.driverId;
      originCity = trip.originCity;
      destinationCity = trip.destinationCity;

      if (trip.status !== TripStatus.SCHEDULED) {
        throw new BadRequestException('Trip is no longer available for booking');
      }
      if (trip.driverId === passenger.id) {
        throw new BadRequestException('You cannot book your own trip');
      }
      if (trip.availableSeats < dto.seatsCount) {
        throw new BadRequestException(`Only ${trip.availableSeats} seat(s) remaining`);
      }
      if (trip.womenOnly && passenger.gender !== Gender.FEMALE) {
        throw new ForbiddenException('This trip is for women passengers only');
      }

      // platform_config is what the admin screen edits, so it has to win. Reading only
      // the env var meant a rate changed in the dashboard was silently ignored while
      // bookings kept charging the old one. Env is the fallback for a fresh database.
      const commissionRate = await this.getConfigNum(
        CONFIG_KEYS.COMMISSION_RATE,
        parseFloat(this.config.get<string>('DEFAULT_COMMISSION_RATE') ?? '0.10'),
      );
      const grossAmount = parseFloat(trip.pricePerSeat.toString()) * dto.seatsCount;

      // Apply promo balance if requested
      let promoDiscount = 0;
      if (dto.usePromo) {
        const freshUser = await manager.findOne(User, {
          where: { id: passenger.id },
          select: { id: true, promoBalance: true },
        });
        const available = Number(freshUser?.promoBalance ?? 0);
        if (available > 0) {
          promoDiscount = +Math.min(available, grossAmount).toFixed(2);
        }
      }
      const totalAmount = +(grossAmount - promoDiscount).toFixed(2);

      // Commission is always on gross so driver payout never changes
      const commissionAmount = +(grossAmount * commissionRate).toFixed(2);
      const driverPayoutAmount = +(grossAmount - commissionAmount).toFixed(2);

      const autoConfirmAfter = new Date(trip.departureTime);
      autoConfirmAfter.setHours(autoConfirmAfter.getHours() + AUTO_CONFIRM_HOURS);

      const isOnline = dto.paymentMethod && dto.paymentMethod !== PaymentMethod.CASH;

      const booking = manager.create(Booking, {
        tripId: trip.id,
        passengerId: passenger.id,
        seatsCount: dto.seatsCount,
        totalAmount,
        commissionAmount,
        driverPayoutAmount,
        commissionRate,
        promoDiscountAmount: promoDiscount,
        paymentMethod: dto.paymentMethod ?? PaymentMethod.CASH,
        status: isOnline ? BookingStatus.PENDING_PAYMENT : BookingStatus.PENDING_DRIVER_APPROVAL,
        autoConfirmAfter,
      });

      const savedBooking = await manager.save(Booking, booking);

      // Decrement promoBalance atomically inside the transaction
      if (promoDiscount > 0) {
        await manager.decrement(User, { id: passenger.id }, 'promoBalance', promoDiscount);
      }

      const payment = manager.create(Payment, {
        bookingId: savedBooking.id,
        amount: totalAmount,  // passenger pays reduced amount
        currency: 'EGP',
        status: isOnline ? PaymentStatus.PENDING : PaymentStatus.CAPTURED,
        isCash: !isOnline,
        gatewayName: isOnline ? 'kashier' : undefined,
        gatewayOrderId: isOnline ? savedBooking.id : undefined,
      });
      await manager.save(Payment, payment);

      trip.availableSeats -= dto.seatsCount;
      await manager.save(Trip, trip);

      return savedBooking;
    });

    // For online payments, create a Kashier payment session and return the URL
    const isOnline = dto.paymentMethod && dto.paymentMethod !== PaymentMethod.CASH;
    if (isOnline) {
      try {
        // Attach passenger so KashierService can pass customer details
        booking.passenger = passenger;
        const { sessionUrl, sessionId } = await this.kashier.createPaymentSession(booking);
        (booking as Booking & { paymentUrl?: string }).paymentUrl = sessionUrl;
        if (sessionId) {
          await this.paymentRepo.update({ bookingId: booking.id }, { gatewaySessionId: sessionId });
        }
      } catch (err) {
        // Roll back the booking so the user can retry
        await this.bookingRepo.update(booking.id, {
          status: BookingStatus.CANCELLED_BY_PASSENGER,
          cancellationReason: 'Payment session creation failed',
          cancelledAt: new Date(),
        });
        await this.tripRepo
          .createQueryBuilder()
          .update(Trip)
          .set({ availableSeats: () => `available_seats + ${booking.seatsCount}` })
          .where('id = :id', { id: booking.tripId })
          .execute();
        throw new BadRequestException('فشل إنشاء جلسة الدفع. يرجى المحاولة مجدداً.');
      }
      // Don't notify driver yet — will notify after payment is authorized (via webhook)
      return booking as Booking & { paymentUrl: string };
    }

    // Notify driver of new cash booking request (fire-and-forget)
    setImmediate(() => {
      void this.notifications.sendToUser(driverId, {
        title: 'طلب حجز جديد',
        body: `لديك طلب حجز جديد على رحلتك من ${originCity} إلى ${destinationCity} — لديك 30 دقيقة للرد`,
        data: { bookingId: booking.id, tripId: booking.tripId, screen: 'trip_passengers' },
      });
    });

    return booking;
  }

  async approveBooking(bookingId: string, driver: User): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId, status: BookingStatus.PENDING_DRIVER_APPROVAL },
        relations: { trip: true },
      });
      if (!booking) throw new NotFoundException('Booking not found or not pending approval');
      if (booking.trip.driverId !== driver.id) {
        throw new ForbiddenException('Not your trip');
      }

      booking.status = BookingStatus.CONFIRMED;
      booking.confirmedAt = new Date();
      const saved = await manager.save(Booking, booking);

      setImmediate(() => {
        void this.notifications.sendToUser(booking.passengerId, {
          title: 'تمت الموافقة على حجزك ✅',
          body: `تمت الموافقة على حجزك في رحلة ${booking.trip.originCity} إلى ${booking.trip.destinationCity}`,
          data: { bookingId: booking.id, tripId: booking.tripId, screen: 'my_bookings' },
        });
      });

      return saved;
    });
  }

  async rejectBooking(bookingId: string, driver: User): Promise<Booking> {
    const saved = await this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId, status: BookingStatus.PENDING_DRIVER_APPROVAL },
        relations: { trip: true },
      });
      if (!booking) throw new NotFoundException('Booking not found or not pending approval');
      if (booking.trip.driverId !== driver.id) {
        throw new ForbiddenException('Not your trip');
      }

      booking.status = BookingStatus.CANCELLED_BY_DRIVER;
      booking.cancelledAt = new Date();
      const result = await manager.save(Booking, booking);

      // Restore seats
      await manager
        .createQueryBuilder()
        .update(Trip)
        .set({ availableSeats: () => `available_seats + ${booking.seatsCount}` })
        .where('id = :id', { id: booking.tripId })
        .execute();

      setImmediate(() => {
        void this.notifications.sendToUser(booking.passengerId, {
          title: 'طلب الحجز مرفوض',
          body: 'عذراً، رفض السائق طلب حجزك',
          data: { bookingId: booking.id, tripId: booking.tripId, screen: 'my_bookings' },
        });
      });

      return result;
    });

    // Outside the transaction: the passenger never got the ride, so give the money
    // back. Kept out of the transaction so a slow gateway call doesn't hold locks.
    await this.returnFundsForRejectedBooking(bookingId);

    return saved;
  }

  /**
   * Returns a rejected booking's money. Voids when the amount was only authorized,
   * refunds when it was already captured — which of those applies depends on whether
   * Kashier has Authorization Capture enabled, so both must be handled.
   * Leaves the payment untouched on failure so it stays visible for a retry.
   */
  private async returnFundsForRejectedBooking(bookingId: string): Promise<void> {
    const payment = await this.paymentRepo.findOne({ where: { bookingId } });
    if (!payment || payment.isCash) return;

    const orderId = payment.gatewayTransactionId ?? payment.gatewayOrderId;
    if (!orderId) return;

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
        return; // already released, refunded or failed — nothing owed
      }
      await this.paymentRepo.save(payment);
    } catch (err) {
      this.logger.error(
        `Failed to return funds for rejected booking ${bookingId} ` +
          `(payment ${payment.id}, status ${payment.status}): ${err}`,
      );
    }
  }

  /** Runs every 5 minutes — auto-rejects bookings pending for over 30 minutes */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoRejectExpiredBookings(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);

    const expired = await this.bookingRepo.find({
      where: {
        status: BookingStatus.PENDING_DRIVER_APPROVAL,
        createdAt: LessThan(cutoff),
      },
    });

    for (const booking of expired) {
      await this.dataSource.transaction(async (manager) => {
        booking.status = BookingStatus.CANCELLED_BY_DRIVER;
        booking.cancelledAt = new Date();
        booking.cancellationReason = 'انتهت مهلة موافقة السائق';
        await manager.save(Booking, booking);

        await manager
          .createQueryBuilder()
          .update(Trip)
          .set({ availableSeats: () => `available_seats + ${booking.seatsCount}` })
          .where('id = :id', { id: booking.tripId })
          .execute();
      });

      // The driver never responded, so the passenger must not stay out of pocket
      await this.returnFundsForRejectedBooking(booking.id);

      setImmediate(() => {
        void this.notifications.sendToUser(booking.passengerId, {
          title: 'انتهت مهلة الموافقة',
          body: 'انتهت مهلة الموافقة على حجزك',
          data: { bookingId: booking.id, tripId: booking.tripId, screen: 'my_bookings' },
        });
      });
    }
  }

  async confirmCompletion(bookingId: string, user: User): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        relations: { trip: true },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new BadRequestException('Booking is not in confirmed state');
      }

      const isDriver = booking.trip.driverId === user.id;
      const isPassenger = booking.passengerId === user.id;

      if (!isDriver && !isPassenger) throw new ForbiddenException('Not your booking');

      if (isDriver) booking.driverConfirmedCompletion = true;
      if (isPassenger) booking.passengerConfirmedCompletion = true;

      const bothConfirmed =
        booking.driverConfirmedCompletion && booking.passengerConfirmedCompletion;

      if (bothConfirmed) {
        await this.releaseEscrow(manager, booking);
      } else {
        await manager.save(Booking, booking);
      }

      return booking;
    });
  }

  private async releaseEscrow(manager: any, booking: Booking): Promise<void> {
    booking.status = BookingStatus.TRIP_COMPLETED;
    booking.completedAt = new Date();
    await manager.save(Booking, booking);

    const payment = await manager.findOne(Payment, { where: { bookingId: booking.id } });
    if (payment && !payment.isCash && payment.gatewayOrderId) {
      // Capture the full amount — platform keeps commission, credits driver's balance separately
      try {
        await this.kashier.capturePayment(payment.gatewayOrderId, Number(booking.totalAmount));
        payment.status = PaymentStatus.CAPTURED;
        payment.capturedAt = new Date();
        await manager.save(Payment, payment);
      } catch (err) {
        this.logger.error?.(`Failed to capture Kashier payment for booking ${booking.id}: ${err}`);
      }
    }

    // Update driver stats
    await manager
      .createQueryBuilder()
      .update('users')
      .set({ completedTripsAsDriver: () => 'completed_trips_as_driver + 1' })
      .where('id = (SELECT driver_id FROM trips WHERE id = :tripId)', { tripId: booking.tripId })
      .execute();

    await manager
      .createQueryBuilder()
      .update('users')
      .set({ completedTripsAsPassenger: () => 'completed_trips_as_passenger + 1' })
      .where('id = :id', { id: booking.passengerId })
      .execute();

    // Referral reward: credit the referrer on the passenger's first completed trip
    const passenger = await manager.findOne(User, {
      where: { id: booking.passengerId },
      select: { id: true, referredByUserId: true },
    });
    if (passenger?.referredByUserId) {
      const existingReward = await manager.findOne(ReferralReward, {
        where: { referredUserId: booking.passengerId },
      });
      if (!existingReward) {
        const REFERRAL_REWARD_EGP = 30;
        const reward = manager.create(ReferralReward, {
          referrerId: passenger.referredByUserId,
          referredUserId: booking.passengerId,
          amount: REFERRAL_REWARD_EGP,
        });
        await manager.save(ReferralReward, reward);
        await manager
          .createQueryBuilder()
          .update(User)
          .set({ promoBalance: () => `promo_balance + ${REFERRAL_REWARD_EGP}` })
          .where('id = :id', { id: passenger.referredByUserId })
          .execute();
        setImmediate(() => {
          void this.notifications.sendToUser(passenger.referredByUserId!, {
            title: 'مكافأة الدعوة',
            body: `رفيقك أكمل أول رحلة — حصلت على ${REFERRAL_REWARD_EGP} جنيه في رصيدك!`,
            data: { screen: 'my_bookings' },
          });
        });
      }
    }
  }

  async cancelByPassenger(
    bookingId: string,
    passenger: User,
    reason?: string,
  ): Promise<Booking & { refundAmount: number; policy: string }> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: bookingId },
        relations: { trip: true },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.passengerId !== passenger.id) throw new ForbiddenException('Not your booking');

      const wasConfirmed = booking.status === BookingStatus.CONFIRMED;

      if (
        booking.status !== BookingStatus.CONFIRMED &&
        booking.status !== BookingStatus.PENDING_DRIVER_APPROVAL
      ) {
        throw new BadRequestException('Cannot cancel in current state');
      }
      if (
        booking.trip.status === TripStatus.ACTIVE ||
        booking.trip.status === TripStatus.COMPLETED
      ) {
        throw new BadRequestException('Cannot cancel a trip that has already started');
      }

      const isCash = booking.paymentMethod === PaymentMethod.CASH;
      const now = new Date();
      const hoursUntil =
        (booking.trip.departureTime.getTime() - now.getTime()) / 3_600_000;

      const [freeCancelHours, lateCancelHours, lateCancelFeePct, driverCompPct] =
        await Promise.all([
          this.getConfigNum(CONFIG_KEYS.FREE_CANCEL_HOURS, 48),
          this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_HOURS, 2),
          this.getConfigNum(CONFIG_KEYS.LATE_CANCEL_FEE_PCT, 0.15),
          this.getConfigNum(CONFIG_KEYS.DRIVER_COMPENSATION_PCT, 0.05),
        ]);

      const total = booking.totalAmount;
      let policy: string;
      let refundAmount: number;
      let driverBonus = 0;

      // If booking was still pending approval, free cancel always
      if (!wasConfirmed || isCash || hoursUntil >= freeCancelHours) {
        policy = 'free_cancel';
        refundAmount = total;
      } else if (hoursUntil >= lateCancelHours) {
        policy = 'late_cancel';
        const fee = +(total * lateCancelFeePct).toFixed(2);
        refundAmount = +(total - fee).toFixed(2);
        driverBonus = +(total * driverCompPct).toFixed(2);
      } else {
        policy = 'no_refund';
        refundAmount = 0;
      }

      // Restore seats to the trip
      await manager
        .createQueryBuilder()
        .update(Trip)
        .set({ availableSeats: () => `available_seats + ${booking.seatsCount}` })
        .where('id = :id', { id: booking.tripId })
        .execute();

      // Process payment — real Kashier API calls for online payments
      const payment = await manager.findOne(Payment, { where: { bookingId } });
      if (payment && !isCash) {
        const orderId = payment.gatewayTransactionId ?? payment.gatewayOrderId;

        if (payment.status === PaymentStatus.PENDING) {
          // Payment is authorized (held) but not yet captured
          if (policy === 'free_cancel') {
            // Void the authorization — passenger's held funds are freed. Voiding an
            // authorize is exempt from Kashier's same-day void window.
            await this.kashier.releasePayment(orderId, payment.kashierTransactionId ?? undefined);
            payment.status = PaymentStatus.RELEASED;
            payment.releasedAt = new Date();
          } else if (policy === 'late_cancel') {
            // Capture the full amount first, then refund the passenger's share
            await this.kashier.capturePayment(orderId, Number(payment.amount));
            payment.status = PaymentStatus.CAPTURED;
            payment.capturedAt = new Date();
            await manager.save(Payment, payment);
            await this.kashier.refundPayment(orderId, refundAmount);
            payment.status = PaymentStatus.PARTIALLY_REFUNDED;
            payment.refundAmount = refundAmount;
            payment.refundedAt = new Date();
          } else {
            // no_refund: capture the full amount (driver keeps it all)
            await this.kashier.capturePayment(orderId, Number(payment.amount));
            payment.status = PaymentStatus.CAPTURED;
            payment.capturedAt = new Date();
          }
        } else if (payment.status === PaymentStatus.CAPTURED) {
          // Already captured — issue a refund for the appropriate amount
          if (refundAmount >= Number(total)) {
            await this.kashier.refundPayment(orderId, Number(total));
            payment.status = PaymentStatus.REFUNDED;
            payment.refundAmount = Number(total);
            payment.refundedAt = new Date();
          } else if (refundAmount > 0) {
            await this.kashier.refundPayment(orderId, refundAmount);
            payment.status = PaymentStatus.PARTIALLY_REFUNDED;
            payment.refundAmount = refundAmount;
            payment.refundedAt = new Date();
          }
          // no_refund + already captured: no action needed
        }

        await manager.save(Payment, payment);
      }

      // Restore promo discount to passenger's balance on free cancellation
      if (policy === 'free_cancel' && Number(booking.promoDiscountAmount) > 0) {
        await manager.increment(User, { id: passenger.id }, 'promoBalance', Number(booking.promoDiscountAmount));
      }

      booking.status =
        refundAmount > 0 ? BookingStatus.REFUNDED : BookingStatus.CANCELLED_BY_PASSENGER;
      booking.cancelledAt = new Date();
      booking.cancellationReason = reason ?? '';
      const saved = await manager.save(Booking, booking);

      // Strike system — late cancellation of a confirmed booking
      if (hoursUntil < 24 && wasConfirmed) {
        const passengerData = await manager.findOne(User, {
          where: { id: booking.passengerId },
          select: { id: true, cancellationStrikes: true },
        });
        const newStrikes = ((passengerData?.cancellationStrikes ?? 0) + 1);
        if (newStrikes >= 3) {
          const restrictedUntil = new Date();
          restrictedUntil.setDate(restrictedUntil.getDate() + 30);
          await manager.update(User, { id: booking.passengerId }, {
            cancellationStrikes: 0,
            cashBookingRestrictedUntil: restrictedUntil,
          });
        } else {
          await manager.update(User, { id: booking.passengerId }, {
            cancellationStrikes: newStrikes,
          });
        }
        setImmediate(() => {
          void this.notifications.sendToUser(booking.passengerId, {
            title: 'تحذير: إلغاء متأخر',
            body: 'تحذير: لديك تحذير إلغاء متأخر',
            data: { screen: 'my_bookings' },
          });
        });
      }

      // Notify driver
      setImmediate(() => {
        const passengerName = passenger.fullName || passenger.phoneNumber;
        const seatsWord = booking.seatsCount === 1 ? 'مقعد' : 'مقاعد';
        const bonusNote = driverBonus > 0 ? ` وستحصل على ${driverBonus} جنيه تعويضاً` : '';
        void this.notifications.sendToUser(booking.trip.driverId, {
          title: 'إلغاء حجز',
          body: `${passengerName} ألغى حجز ${booking.seatsCount} ${seatsWord}${bonusNote}`,
          data: { bookingId: booking.id, tripId: booking.tripId, screen: 'trip_passengers' },
        });
      });

      return Object.assign(saved, { refundAmount, policy });
    });
  }

  async getPassengerBookings(passengerId: string): Promise<(Booking & { hasRated: boolean })[]> {
    const bookings = await this.bookingRepo.find({
      where: { passengerId },
      relations: { trip: { driver: true } },
      order: { createdAt: 'DESC' },
    });
    if (bookings.length === 0) return [];

    const bookingIds = bookings.map((b) => b.id);
    const ratedRows = await this.dataSource.query<Array<{ booking_id: string }>>(
      `SELECT booking_id FROM ratings WHERE rater_id = $1 AND booking_id = ANY($2)`,
      [passengerId, bookingIds],
    );
    const ratedSet = new Set(ratedRows.map((r) => r.booking_id));
    return bookings.map((b) => Object.assign(b, { hasRated: ratedSet.has(b.id) }));
  }

  async findById(id: string): Promise<Booking> {
    const booking = await this.bookingRepo.findOne({
      where: { id },
      relations: { trip: { driver: true }, passenger: true, payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    // Webhook recovery: if still pending_payment, check Kashier directly
    if (booking.status === BookingStatus.PENDING_PAYMENT && booking.payment?.gatewaySessionId) {
      const kashierStatus = await this.kashier.getPaymentStatus(booking.payment.gatewaySessionId);
      if (kashierStatus === 'AUTHORIZED' || kashierStatus === 'CAPTURED') {
        booking.status = BookingStatus.PENDING_DRIVER_APPROVAL;
        booking.payment.status = PaymentStatus.PENDING;
        await this.bookingRepo.save(booking);
        this.logger.log(`findById recovery: booking ${id} updated to pending_driver_approval`);

        if (booking.trip?.driverId) {
          setImmediate(() => void this.notifications.sendToUser(booking.trip.driverId, {
            title: 'طلب حجز جديد 🎉',
            body: `راكب دفع ${booking.totalAmount} ج وينتظر موافقتك`,
            data: { screen: 'driver_bookings', tripId: booking.tripId },
          }));
        }
      }
    }

    return booking;
  }

  // Called from the in-app WebView after it intercepts Kashier's payment redirect.
  //
  // The caller controls both arguments, so neither is evidence of payment: without the
  // ownership check any signed-in user could heal someone else's booking, and without
  // asking Kashier directly an invented orderId would mark an unpaid booking as paid.
  // Kashier's own guidance is to confirm every payment server-side before releasing
  // goods, so the redirect only triggers the check — it never supplies the answer.
  async healFromRedirect(
    bookingId: string,
    kashierOrderId: string,
    passenger: User,
  ): Promise<{ healed: boolean }> {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: { payment: true, trip: true },
    });
    if (!booking) return { healed: false };

    if (booking.passengerId !== passenger.id) {
      throw new ForbiddenException('Not your booking');
    }

    if (booking.payment) {
      booking.payment.gatewayTransactionId = kashierOrderId;
      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        const kashierStatus = await this.kashier.getPaymentStatus(
          booking.payment.gatewaySessionId,
        );
        const paid =
          kashierStatus === 'AUTHORIZED' ||
          kashierStatus === 'CAPTURED' ||
          kashierStatus === 'SUCCESS';
        if (!paid) {
          this.logger.warn(
            `healFromRedirect refused for booking ${bookingId}: Kashier reports ` +
              `${kashierStatus ?? 'unknown'} for session ${booking.payment.gatewaySessionId ?? 'none'}`,
          );
          await this.bookingRepo.manager.save(Payment, booking.payment);
          return { healed: false };
        }
        booking.payment.status = PaymentStatus.PENDING;
        await this.bookingRepo.manager.save(Payment, booking.payment);
        booking.status = BookingStatus.PENDING_DRIVER_APPROVAL;
        await this.bookingRepo.save(booking);
        this.logger.log(`healFromRedirect: booking ${bookingId} → pending_driver_approval, kashierOrderId=${kashierOrderId}`);
        if (booking.trip?.driverId) {
          setImmediate(() => void this.notifications.sendToUser(booking.trip.driverId, {
            title: 'طلب حجز جديد 🎉',
            body: `راكب دفع ${booking.totalAmount} ج وينتظر موافقتك`,
            data: { screen: 'driver_bookings', tripId: booking.tripId },
          }));
        }
        return { healed: true };
      }
      await this.bookingRepo.manager.save(Payment, booking.payment);
    }
    return { healed: false };
  }

  async openDispute(user: User, dto: OpenDisputeDto): Promise<Dispute> {
    return this.dataSource.transaction(async (manager) => {
      const booking = await manager.findOne(Booking, {
        where: { id: dto.bookingId },
        relations: { trip: true },
      });

      if (!booking) throw new NotFoundException('Booking not found');

      const isDriver = booking.trip.driverId === user.id;
      const isPassenger = booking.passengerId === user.id;
      if (!isDriver && !isPassenger) throw new ForbiddenException('Not your booking');

      if (
        booking.status !== BookingStatus.CONFIRMED &&
        booking.status !== BookingStatus.TRIP_COMPLETED
      ) {
        throw new BadRequestException('Can only dispute confirmed or completed bookings');
      }

      const existing = await manager.findOne(Dispute, { where: { bookingId: dto.bookingId } });
      if (existing) throw new BadRequestException('A dispute already exists for this booking');

      const slaDeadline = new Date();
      slaDeadline.setHours(slaDeadline.getHours() + 48);

      booking.status = BookingStatus.DISPUTED;
      await manager.save(Booking, booking);

      const dispute = manager.create(Dispute, {
        bookingId: dto.bookingId,
        tripId: booking.tripId,
        openedByUserId: user.id,
        reason: dto.reason,
        description: dto.description,
        evidenceUrls: dto.evidenceUrls ?? [],
        status: DisputeStatus.OPEN,
        slaDeadline,
      });

      const saved = await manager.save(Dispute, dispute);

      booking.disputeId = saved.id;
      await manager.save(Booking, booking);

      const otherPartyId = isDriver ? booking.passengerId : booking.trip.driverId;
      await manager
        .createQueryBuilder()
        .update(User)
        .set({ disputeCount: () => 'dispute_count + 1' })
        .where('id = :id', { id: otherPartyId })
        .execute();

      setImmediate(() => {
        void this.notifications.sendToUser(otherPartyId, {
          title: 'Dispute opened on your trip',
          body: 'A dispute has been opened on one of your bookings. Please submit your response within 48 hours.',
          data: { disputeId: saved.id, bookingId: booking.id, screen: 'dispute_detail' },
        });
      });

      return saved;
    });
  }

  // Dev-only: simulate Kashier authorization webhook for a PENDING_PAYMENT booking
  async mockConfirmPayment(bookingId: string): Promise<void> {
    if (!this.kashier.isMock) return;

    const payment = await this.dataSource.manager.findOne(Payment, {
      where: { gatewayOrderId: bookingId },
    });
    if (!payment) return;

    const booking = await this.bookingRepo.findOne({ where: { id: bookingId } });
    if (!booking || booking.status !== BookingStatus.PENDING_PAYMENT) return;

    payment.status = PaymentStatus.PENDING;
    await this.dataSource.manager.save(Payment, payment);

    booking.status = BookingStatus.PENDING_DRIVER_APPROVAL;
    await this.bookingRepo.save(booking);

    this.logger.log(`Mock confirmed payment for booking ${bookingId}`);
  }
}
