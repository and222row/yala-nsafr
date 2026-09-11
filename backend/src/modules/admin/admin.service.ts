import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, ILike, In, LessThan } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Trip, TripStatus } from '../../database/entities/trip.entity';
import { Booking, BookingStatus } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Dispute, DisputeStatus, DisputeReason } from '../../database/entities/dispute.entity';
import { PlatformConfig, CONFIG_KEYS } from '../../database/entities/platform-config.entity';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { NotifyPartyDto } from './dto/notify-party.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ListUsersQueryDto, ListDisputesQueryDto, ListTripsQueryDto } from './dto/list-query.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(PlatformConfig)
    private readonly configRepo: Repository<PlatformConfig>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Seed default config on first run ──────────────────────────────────────
  async onModuleInit() {
    const defaults: Array<{ key: string; value: string; description: string }> = [
      { key: CONFIG_KEYS.COMMISSION_RATE, value: '0.07', description: 'Platform commission rate (0–0.5)' },
      { key: CONFIG_KEYS.AUTO_CONFIRM_HOURS, value: '2', description: 'Hours after departure to auto-confirm trip completion' },
      { key: CONFIG_KEYS.DISPUTE_WINDOW_HOURS, value: '48', description: 'Hours after trip to open a dispute' },
      { key: CONFIG_KEYS.RATING_REVEAL_DAYS, value: '7', description: 'Days before ratings are revealed if partner has not rated' },
      { key: CONFIG_KEYS.LOW_RATING_THRESHOLD, value: '2.5', description: 'Average rating below which an account is trust-flagged' },
      { key: CONFIG_KEYS.MIN_RATINGS_FOR_FLAG, value: '5', description: 'Minimum ratings before trust-flag check applies' },
      { key: CONFIG_KEYS.FREE_CANCEL_HOURS, value: '48', description: 'Hours before departure for free full-refund cancellation' },
      { key: CONFIG_KEYS.LATE_CANCEL_HOURS, value: '2', description: 'Hours before departure below which no refund is given' },
      { key: CONFIG_KEYS.LATE_CANCEL_FEE_PCT, value: '0.15', description: 'Platform fee % deducted from refund in the late-cancel window (0–1)' },
      { key: CONFIG_KEYS.DRIVER_COMPENSATION_PCT, value: '0.05', description: 'Driver compensation % from late-cancel fee (0–1)' },
    ];

    for (const entry of defaults) {
      const existing = await this.configRepo.findOne({ where: { key: entry.key } });
      if (!existing) {
        await this.configRepo.save(this.configRepo.create(entry));
      }
    }
  }

  // ── Config ─────────────────────────────────────────────────────────────────
  async getConfig(): Promise<Record<string, string>> {
    const entries = await this.configRepo.find();
    return Object.fromEntries(entries.map((e) => [e.key, e.value]));
  }

  async updateConfig(dto: UpdateConfigDto): Promise<Record<string, string>> {
    const updates: Array<{ key: string; value: string }> = [];

    if (dto.commissionRate !== undefined) {
      updates.push({ key: CONFIG_KEYS.COMMISSION_RATE, value: String(dto.commissionRate) });
    }
    if (dto.autoConfirmHours !== undefined) {
      updates.push({ key: CONFIG_KEYS.AUTO_CONFIRM_HOURS, value: String(dto.autoConfirmHours) });
    }
    if (dto.disputeWindowHours !== undefined) {
      updates.push({ key: CONFIG_KEYS.DISPUTE_WINDOW_HOURS, value: String(dto.disputeWindowHours) });
    }
    if (dto.ratingRevealDays !== undefined) {
      updates.push({ key: CONFIG_KEYS.RATING_REVEAL_DAYS, value: String(dto.ratingRevealDays) });
    }

    for (const { key, value } of updates) {
      await this.configRepo.update({ key }, { value });
    }

    return this.getConfig();
  }

  async getConfigValue(key: string): Promise<string> {
    const entry = await this.configRepo.findOne({ where: { key } });
    return entry?.value ?? '';
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  async listUsers(query: ListUsersQueryDto) {
    const qb = this.userRepo.createQueryBuilder('u');

    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.idVerified !== undefined) {
      qb.andWhere('u.id_verified = :idVerified', { idVerified: query.idVerified === 'true' });
    }
    if (query.driverVerified !== undefined) {
      qb.andWhere('u.driver_verified = :driverVerified', { driverVerified: query.driverVerified === 'true' });
    }
    if (query.trustFlagged !== undefined) {
      qb.andWhere('u.trust_flagged = :trustFlagged', { trustFlagged: query.trustFlagged === 'true' });
    }
    if (query.search) {
      qb.andWhere('(u.full_name ILIKE :search OR u.phone_number ILIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('u.created_at', 'DESC');

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    qb.skip((page - 1) * limit).take(limit);

    const [users, total] = await qb.getManyAndCount();
    return { data: users, total, page, limit };
  }

  async getUserDetail(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async approveIdVerification(userId: string, adminId: string): Promise<User> {
    const user = await this.getUserDetail(userId);
    if (!user.nationalIdNumber) {
      throw new BadRequestException('User has not submitted ID verification');
    }
    user.idVerified = true;
    user.idVerifiedAt = new Date();
    if (user.status === UserStatus.PENDING_VERIFICATION) {
      user.status = UserStatus.ACTIVE;
    }
    return this.userRepo.save(user);
  }

  async approveDriverVerification(userId: string, adminId: string): Promise<User> {
    const user = await this.getUserDetail(userId);
    if (!user.vehicleMake || !user.vehiclePlate) {
      throw new BadRequestException('User has not submitted driver verification');
    }
    if (!user.idVerified) {
      throw new BadRequestException('ID must be verified before driver verification is approved');
    }
    user.driverVerified = true;
    return this.userRepo.save(user);
  }

  async rejectIdVerification(userId: string): Promise<User> {
    const user = await this.getUserDetail(userId);
    user.nationalIdNumber = '';
    user.nationalIdPhotoUrl = '';
    return this.userRepo.save(user);
  }

  async rejectDriverVerification(userId: string): Promise<User> {
    const user = await this.getUserDetail(userId);
    user.driverVerified = false;
    user.drivingLicenceNumber = '';
    user.vehiclePlate = '';
    return this.userRepo.save(user);
  }

  async updateUserStatus(userId: string, dto: UpdateUserStatusDto): Promise<User> {
    const user = await this.getUserDetail(userId);
    user.status = dto.status;
    return this.userRepo.save(user);
  }

  // ── Trips ──────────────────────────────────────────────────────────────────
  async listTrips(query: ListTripsQueryDto) {
    const qb = this.tripRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.driver', 'driver');

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.driverId) qb.andWhere('t.driver_id = :driverId', { driverId: query.driverId });

    qb.orderBy('t.departure_time', 'DESC');

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    qb.skip((page - 1) * limit).take(limit);

    const [trips, total] = await qb.getManyAndCount();
    return { data: trips, total, page, limit };
  }

  async getTripDetail(id: string) {
    const trip = await this.tripRepo.findOne({
      where: { id },
      relations: { driver: true, bookings: { passenger: true, payment: true } },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  // ── Disputes ───────────────────────────────────────────────────────────────
  async listDisputes(query: ListDisputesQueryDto) {
    const qb = this.disputeRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.openedBy', 'openedBy');

    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.assignedAdminId) {
      qb.andWhere('d.assigned_admin_id = :adminId', { adminId: query.assignedAdminId });
    }

    qb.orderBy('d.created_at', 'ASC');

    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    qb.skip((page - 1) * limit).take(limit);

    const [disputes, total] = await qb.getManyAndCount();
    return { data: disputes, total, page, limit };
  }

  async getDisputeDetail(id: string) {
    const dispute = await this.disputeRepo.findOne({
      where: { id },
      relations: { openedBy: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const booking = await this.bookingRepo.findOne({
      where: { id: dispute.bookingId },
      relations: { trip: { driver: true }, passenger: true, payment: true },
    });

    return { dispute, booking };
  }

  async assignDispute(disputeId: string, adminId: string): Promise<Dispute> {
    const dispute = await this.disputeRepo.findOne({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.status !== DisputeStatus.OPEN) {
      throw new BadRequestException('Can only assign open disputes');
    }
    dispute.assignedAdminId = adminId;
    dispute.status = DisputeStatus.UNDER_REVIEW;
    return this.disputeRepo.save(dispute);
  }

  async resolveDispute(disputeId: string, adminId: string, dto: ResolveDisputeDto): Promise<Dispute> {
    return this.dataSource.transaction(async (manager) => {
      const dispute = await manager.findOne(Dispute, { where: { id: disputeId } });
      if (!dispute) throw new NotFoundException('Dispute not found');
      if (
        dispute.status !== DisputeStatus.OPEN &&
        dispute.status !== DisputeStatus.UNDER_REVIEW
      ) {
        throw new BadRequestException('Dispute is already resolved');
      }

      const booking = await manager.findOne(Booking, {
        where: { id: dispute.bookingId },
        relations: { payment: true, trip: true },
      });
      if (!booking) throw new NotFoundException('Booking not found');

      const payment = booking.payment;

      switch (dto.resolution) {
        case DisputeStatus.RESOLVED_REFUND: {
          // Full refund to passenger
          booking.status = BookingStatus.REFUNDED;
          if (payment) {
            payment.status = PaymentStatus.REFUNDED;
            payment.refundedAt = new Date();
            payment.refundAmount = payment.amount;
            await manager.save(Payment, payment);
          }
          break;
        }
        case DisputeStatus.RESOLVED_RELEASE: {
          // Full payout to driver
          booking.status = BookingStatus.TRIP_COMPLETED;
          booking.completedAt = new Date();
          if (payment) {
            payment.status = PaymentStatus.RELEASED;
            payment.releasedAt = new Date();
            await manager.save(Payment, payment);
          }
          break;
        }
        case DisputeStatus.RESOLVED_SPLIT: {
          // Partial refund — refundAmount goes back to passenger, rest to driver
          const refund = dto.refundAmount ?? 0;
          if (payment && refund > 0) {
            payment.status = PaymentStatus.PARTIALLY_REFUNDED;
            payment.refundAmount = refund;
            payment.refundedAt = new Date();
            await manager.save(Payment, payment);
          }
          booking.status = BookingStatus.TRIP_COMPLETED;
          booking.completedAt = new Date();
          break;
        }
      }

      await manager.save(Booking, booking);

      dispute.status = dto.resolution;
      dispute.assignedAdminId = adminId;
      dispute.resolutionNotes = dto.resolutionNotes;
      if (dto.refundAmount !== undefined) dispute.refundAmount = dto.refundAmount;
      dispute.resolvedAt = new Date();

      const resolved = await manager.save(Dispute, dispute);

      // Optional: block a user as part of the decision
      if (dto.blockUserId && dto.blockStatus) {
        await manager.update(User, dto.blockUserId, { status: dto.blockStatus });
      }

      const outcomeLabel: Record<string, string> = {
        [DisputeStatus.RESOLVED_REFUND]: 'تم البت في النزاع: استرداد المبلغ للراكب.',
        [DisputeStatus.RESOLVED_RELEASE]: 'تم البت في النزاع: الإفراج عن المبلغ للسائق.',
        [DisputeStatus.RESOLVED_SPLIT]: 'تم البت في النزاع: تقسيم المبلغ بين الطرفين.',
      };
      const outcomeText = outcomeLabel[dto.resolution] ?? 'تم البت في النزاع.';

      setImmediate(() => {
        void this.notifications.sendToUsers(
          [dispute.openedByUserId, booking.trip.driverId, booking.passengerId].filter(
            (id, i, arr) => arr.indexOf(id) === i,
          ),
          {
            title: 'تم البت في النزاع',
            body: outcomeText,
            data: { disputeId: dispute.id, screen: 'dispute_detail' },
          },
        );
      });

      return resolved;
    });
  }

  async notifyParty(disputeId: string, adminId: string, dto: NotifyPartyDto): Promise<void> {
    const { dispute, booking } = await this.getDisputeDetail(disputeId);
    if (!booking) throw new NotFoundException('Booking not found');

    const openerId = dispute.openedByUserId;
    const driverId = booking.trip?.driver?.id ?? '';
    const passengerId = booking.passenger?.id ?? '';
    // "other party" = whoever didn't open the dispute
    const otherPartyId = openerId === driverId ? passengerId : driverId;

    const targets: string[] = [];
    if (dto.target === 'opener' || dto.target === 'both') targets.push(openerId);
    if (dto.target === 'other_party' || dto.target === 'both') targets.push(otherPartyId);

    await this.notifications.sendToUsers(
      targets.filter((id) => !!id),
      {
        title: 'رسالة من إدارة يلا نسافر',
        body: dto.message,
        data: { disputeId, screen: 'dispute_detail' },
      },
    );
  }

  // ── SLA cron ───────────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async handleSlaExpiry(): Promise<void> {
    const expired = await this.disputeRepo.find({
      where: {
        status: In([DisputeStatus.OPEN]),
        slaDeadline: LessThan(new Date()),
      },
    });

    if (!expired.length) return;
    this.logger.log(`SLA expiry check: ${expired.length} dispute(s) to process`);

    for (const dispute of expired) {
      try {
        await this.dataSource.transaction(async (manager) => {
          const booking = await manager.findOne(Booking, {
            where: { id: dispute.bookingId },
            relations: { payment: true, trip: true },
          });
          if (!booking) return;

          // Auto-resolution rules based on reason
          const autoRefundReasons = [DisputeReason.NO_SHOW_DRIVER, DisputeReason.UNSAFE_DRIVING];
          const autoReleaseReasons = [DisputeReason.NO_SHOW_PASSENGER];

          let resolution: DisputeStatus;
          let outcomeText: string;

          if (autoRefundReasons.includes(dispute.reason as DisputeReason)) {
            resolution = DisputeStatus.RESOLVED_REFUND;
            outcomeText = 'تم استرداد المبلغ تلقائياً لعدم رد الطرف الآخر في الوقت المحدد.';
            booking.status = BookingStatus.REFUNDED;
            if (booking.payment) {
              booking.payment.status = PaymentStatus.REFUNDED;
              booking.payment.refundedAt = new Date();
              booking.payment.refundAmount = booking.payment.amount;
              await manager.save(Payment, booking.payment);
            }
          } else if (autoReleaseReasons.includes(dispute.reason as DisputeReason)) {
            resolution = DisputeStatus.RESOLVED_RELEASE;
            outcomeText = 'تم الإفراج عن المبلغ للسائق تلقائياً لعدم رد الطرف الآخر.';
            booking.status = BookingStatus.TRIP_COMPLETED;
            booking.completedAt = new Date();
            if (booking.payment) {
              booking.payment.status = PaymentStatus.RELEASED;
              booking.payment.releasedAt = new Date();
              await manager.save(Payment, booking.payment);
            }
          } else {
            // Ambiguous reasons → escalate to manual review instead of auto-resolving
            dispute.status = DisputeStatus.UNDER_REVIEW;
            await manager.save(Dispute, dispute);
            setImmediate(() => {
              void this.notifications.sendToUsers(
                [dispute.openedByUserId],
                {
                  title: 'نزاعك قيد المراجعة',
                  body: 'انتهى وقت الرد وتم تحويل نزاعك إلى الإدارة للبت فيه.',
                  data: { disputeId: dispute.id, screen: 'dispute_detail' },
                },
              );
            });
            return;
          }

          await manager.save(Booking, booking);

          dispute.status = resolution;
          dispute.resolutionNotes = outcomeText;
          dispute.resolvedAt = new Date();
          await manager.save(Dispute, dispute);

          setImmediate(() => {
            void this.notifications.sendToUsers(
              [dispute.openedByUserId, booking.trip.driverId, booking.passengerId].filter(
                (id, i, arr) => arr.indexOf(id) === i,
              ),
              {
                title: 'تم البت في النزاع تلقائياً',
                body: outcomeText,
                data: { disputeId: dispute.id, screen: 'dispute_detail' },
              },
            );
          });
        });
      } catch (err) {
        this.logger.error(`SLA auto-resolve failed for dispute ${dispute.id}: ${err}`);
      }
    }
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  async getAnalytics() {
    const [
      totalUsers,
      activeUsers,
      totalTrips,
      completedTrips,
      cancelledTrips,
      totalBookings,
      openDisputes,
      trustFlaggedUsers,
      pendingIdVerifications,
      pendingDriverVerifications,
    ] = await Promise.all([
      this.userRepo.count(),
      this.userRepo.count({ where: { status: UserStatus.ACTIVE } }),
      this.tripRepo.count(),
      this.tripRepo.count({ where: { status: TripStatus.COMPLETED } }),
      this.tripRepo.count({ where: { status: TripStatus.CANCELLED } }),
      this.bookingRepo.count(),
      this.disputeRepo.count({ where: { status: DisputeStatus.OPEN } }),
      this.userRepo.count({ where: { trustFlagged: true } }),
      this.userRepo
        .createQueryBuilder('u')
        .where('u.national_id_number IS NOT NULL AND u.id_verified = false')
        .getCount(),
      this.userRepo
        .createQueryBuilder('u')
        .where('u.vehicle_plate IS NOT NULL AND u.driver_verified = false')
        .getCount(),
    ]);

    // Revenue: sum of commissions on completed/released payments
    const revenueResult = await this.bookingRepo
      .createQueryBuilder('b')
      .select('COALESCE(SUM(b.commission_amount), 0)', 'total')
      .where('b.status IN (:...statuses)', {
        statuses: [BookingStatus.TRIP_COMPLETED],
      })
      .getRawOne<{ total: string }>();

    const totalRevenue = parseFloat(revenueResult?.total ?? '0');

    // Trips in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentTripsResult = await this.tripRepo
      .createQueryBuilder('t')
      .select('COUNT(*)', 'count')
      .where('t.status = :status AND t.completed_at > :since', {
        status: TripStatus.COMPLETED,
        since: thirtyDaysAgo,
      })
      .getRawOne<{ count: string }>();

    const completedTripsLast30Days = parseInt(recentTripsResult?.count ?? '0', 10);

    // Revenue by city pair (top 5 routes)
    const topRoutes = await this.tripRepo
      .createQueryBuilder('t')
      .select('t.origin_city', 'originCity')
      .addSelect('t.destination_city', 'destinationCity')
      .addSelect('COUNT(*)', 'tripCount')
      .where('t.status = :status', { status: TripStatus.COMPLETED })
      .groupBy('t.origin_city, t.destination_city')
      .orderBy('tripCount', 'DESC')
      .limit(5)
      .getRawMany();

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        trustFlagged: trustFlaggedUsers,
        pendingIdVerifications,
        pendingDriverVerifications,
      },
      trips: {
        total: totalTrips,
        completed: completedTrips,
        cancelled: cancelledTrips,
        completedLast30Days: completedTripsLast30Days,
      },
      bookings: {
        total: totalBookings,
      },
      revenue: {
        totalEgp: totalRevenue,
      },
      disputes: {
        open: openDisputes,
      },
      topRoutes,
    };
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  async search(q: string) {
    const [users, trips] = await Promise.all([
      this.userRepo.find({
        where: [
          { id: q },
          { phoneNumber: ILike(`%${q}%`) },
          { fullName: ILike(`%${q}%`) },
          { nationalIdNumber: ILike(`%${q}%`) },
        ],
        take: 10,
      }),
      this.tripRepo.find({
        where: [{ id: q }],
        relations: { driver: true },
        take: 10,
      }),
    ]);

    return { users, trips };
  }
}
