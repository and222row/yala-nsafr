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
import { Booking, BookingStatus, PaymentMethod } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Dispute, DisputeStatus, DisputeReason } from '../../database/entities/dispute.entity';
import { PlatformConfig, CONFIG_KEYS } from '../../database/entities/platform-config.entity';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { NotifyPartyDto } from './dto/notify-party.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ListUsersQueryDto, ListDisputesQueryDto, ListTripsQueryDto } from './dto/list-query.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PaymentSettlementService,
  PaymentSettlement,
} from '../payments/payment-settlement.service';

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
    private readonly settlement: PaymentSettlementService,
  ) {}

  // ── Seed default config on first run ──────────────────────────────────────
  async onModuleInit() {
    const defaults: Array<{ key: string; value: string; description: string }> = [
      { key: CONFIG_KEYS.COMMISSION_RATE, value: '0.10', description: 'Platform commission rate (0–0.5)' },
      { key: CONFIG_KEYS.AUTO_CONFIRM_HOURS, value: '2', description: 'Hours after departure to auto-confirm trip completion' },
      { key: CONFIG_KEYS.DISPUTE_WINDOW_HOURS, value: '48', description: 'Hours after trip to open a dispute' },
      { key: CONFIG_KEYS.DISPUTE_SLA_HOURS, value: '48', description: 'Hours the other party has to respond before a dispute auto-resolves' },
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
    if (dto.disputeSlaHours !== undefined) {
      updates.push({ key: CONFIG_KEYS.DISPUTE_SLA_HOURS, value: String(dto.disputeSlaHours) });
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

  /**
   * Works out what the gateway owes whom for a dispute outcome. Returns null when there
   * is nothing to move — a cash fare, or a payment already sitting in the right state.
   *
   * The money semantics per outcome:
   *  - refund  → passenger gets everything back: void an untouched hold, refund a capture
   *  - release → driver keeps the fare, so the hold must be *captured*
   *  - split   → capture the fare, then hand the agreed slice back to the passenger
   */
  private planDisputeSettlement(
    payment: Payment | null | undefined,
    isCash: boolean,
    resolution: DisputeStatus,
    refund: number,
  ): PaymentSettlement | null {
    if (!payment || isCash) return null;

    const orderId = payment.gatewayTransactionId ?? payment.gatewayOrderId;
    if (!orderId) return null;

    const targetTransactionId = payment.kashierTransactionId ?? undefined;
    const amount = Number(payment.amount);
    const alreadyRefunded = Number(payment.refundAmount ?? 0);
    const outstanding = +(amount - alreadyRefunded).toFixed(2);
    const base = { paymentId: payment.id, orderId, targetTransactionId };

    switch (resolution) {
      case DisputeStatus.RESOLVED_REFUND:
        // Nothing has been taken yet — voiding the hold is cheaper and faster than
        // capturing only to refund, and is exempt from Kashier's void window.
        if (payment.status === PaymentStatus.PENDING) {
          return { ...base, action: 'void' };
        }
        if (
          payment.status === PaymentStatus.CAPTURED ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED
        ) {
          if (outstanding <= 0) return null;
          return {
            ...base,
            action: 'refund',
            refundAmount: outstanding,
            recordRefundAmount: amount,
            fullRefund: true,
          };
        }
        return null; // already RELEASED or REFUNDED

      case DisputeStatus.RESOLVED_RELEASE:
        // The driver won, so the authorization has to actually be collected. This branch
        // used to write status = RELEASED, which means the opposite — that is the label
        // for a voided hold — and left the winning driver's payout at zero.
        if (payment.status === PaymentStatus.PENDING) {
          return { ...base, action: 'capture', captureAmount: amount };
        }
        return null; // already captured; nothing to move

      case DisputeStatus.RESOLVED_SPLIT: {
        const toRefund = Math.min(refund, outstanding);
        if (toRefund <= 0) {
          // Degenerate split: the driver keeps it all, same as a release
          return payment.status === PaymentStatus.PENDING
            ? { ...base, action: 'capture', captureAmount: amount }
            : null;
        }
        const recordRefundAmount = +(alreadyRefunded + toRefund).toFixed(2);
        const fullRefund = recordRefundAmount >= amount;
        if (payment.status === PaymentStatus.PENDING) {
          return {
            ...base,
            action: 'capture_then_refund',
            captureAmount: amount,
            refundAmount: toRefund,
            recordRefundAmount,
            fullRefund,
          };
        }
        if (
          payment.status === PaymentStatus.CAPTURED ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED
        ) {
          return {
            ...base,
            action: 'refund',
            refundAmount: toRefund,
            recordRefundAmount,
            fullRefund,
          };
        }
        return null;
      }

      default:
        return null;
    }
  }

  async resolveDispute(disputeId: string, adminId: string, dto: ResolveDisputeDto): Promise<Dispute> {
    let settlement: PaymentSettlement | null = null;

    const resolved = await this.dataSource.transaction(async (manager) => {
      const dispute = await manager.findOne(Dispute, {
        where: { id: disputeId },
        lock: { mode: 'pessimistic_write' },
      });
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
      const isCash = booking.paymentMethod === PaymentMethod.CASH || !!payment?.isCash;
      const refund = dto.refundAmount ?? 0;

      if (dto.resolution === DisputeStatus.RESOLVED_SPLIT) {
        if (refund <= 0) {
          throw new BadRequestException('A split resolution needs a refundAmount above zero');
        }
        if (refund > Number(booking.totalAmount)) {
          throw new BadRequestException('refundAmount cannot exceed the amount paid');
        }
      }

      // Decided here, executed after this commits. The gateway must never be called
      // inside the transaction: a capture that succeeds followed by a refund that fails
      // would roll the record back while the passenger's money had already moved.
      settlement = this.planDisputeSettlement(payment, isCash, dto.resolution, refund);

      // Cash never reaches Kashier, but the ruling still has to be recorded: the driver
      // is holding money a refund or split says belongs to the passenger. Safe to write
      // in the transaction precisely because no gateway call can fail underneath it.
      // Earnings reads this so a driver is not shown cash they have been told to return.
      if (isCash && payment) {
        const owedBack =
          dto.resolution === DisputeStatus.RESOLVED_REFUND
            ? Number(payment.amount)
            : dto.resolution === DisputeStatus.RESOLVED_SPLIT
              ? refund
              : 0;
        if (owedBack > 0) {
          payment.refundAmount = owedBack;
          payment.refundedAt = new Date();
          await manager.save(Payment, payment);
        }
      }

      // Only the booking is advanced here. The payment row is moved by the settlement
      // step as each gateway call succeeds, so a Kashier outage leaves a completed
      // booking with a still-PENDING payment — which reconciliation picks up — rather
      // than a record claiming money moved when it did not.
      switch (dto.resolution) {
        case DisputeStatus.RESOLVED_REFUND:
          booking.status = BookingStatus.REFUNDED;
          break;
        case DisputeStatus.RESOLVED_RELEASE:
        case DisputeStatus.RESOLVED_SPLIT:
          booking.status = BookingStatus.TRIP_COMPLETED;
          // Keep the original completion date if the trip had already finished —
          // earnings bucket payouts by month from this field.
          booking.completedAt = booking.completedAt ?? new Date();
          break;
      }

      await manager.save(Booking, booking);

      dispute.status = dto.resolution;
      dispute.assignedAdminId = adminId;
      dispute.resolutionNotes = dto.resolutionNotes;
      if (dto.refundAmount !== undefined) dispute.refundAmount = dto.refundAmount;
      dispute.resolvedAt = new Date();

      const saved = await manager.save(Dispute, dispute);

      // Optional: block a user as part of the decision
      if (dto.blockUserId && dto.blockStatus) {
        await manager.update(User, dto.blockUserId, { status: dto.blockStatus });
      }

      const outcomeLabel: Record<string, string> = {
        [DisputeStatus.RESOLVED_REFUND]: 'تم البت في النزاع: استرداد المبلغ للراكب.',
        [DisputeStatus.RESOLVED_RELEASE]: 'تم البت في النزاع: صرف المبلغ للسائق.',
        [DisputeStatus.RESOLVED_SPLIT]: `تم البت في النزاع: استرداد ${dto.refundAmount ?? 0} جنيه للراكب والباقي للسائق.`,
      };
      // Cash never passes through Kashier, so promising an automatic transfer would be
      // untrue — the parties settle it between themselves.
      const cashNote = isCash
        ? ' الرحلة كانت بالدفع النقدي، لذا تتم التسوية المالية بين الطرفين مباشرةً.'
        : '';
      const outcomeText = (outcomeLabel[dto.resolution] ?? 'تم البت في النزاع.') + cashNote;

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

      return saved;
    });

    await this.settlement.settle(settlement, `dispute ${disputeId}`);

    return resolved;
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
        let settlement: PaymentSettlement | null = null;

        await this.dataSource.transaction(async (manager) => {
          const booking = await manager.findOne(Booking, {
            where: { id: dispute.bookingId },
            relations: { payment: true, trip: true },
          });
          if (!booking) return;

          // Auto-resolution rules based on reason
          const autoRefundReasons = [DisputeReason.NO_SHOW_DRIVER, DisputeReason.UNSAFE_DRIVING];
          const autoReleaseReasons = [DisputeReason.NO_SHOW_PASSENGER];

          const isCash =
            booking.paymentMethod === PaymentMethod.CASH || !!booking.payment?.isCash;

          let resolution: DisputeStatus;
          let outcomeText: string;

          if (autoRefundReasons.includes(dispute.reason as DisputeReason)) {
            resolution = DisputeStatus.RESOLVED_REFUND;
            outcomeText = 'تم استرداد المبلغ تلقائياً لعدم رد الطرف الآخر في الوقت المحدد.';
            booking.status = BookingStatus.REFUNDED;
          } else if (autoReleaseReasons.includes(dispute.reason as DisputeReason)) {
            resolution = DisputeStatus.RESOLVED_RELEASE;
            outcomeText = 'تم صرف المبلغ للسائق تلقائياً لعدم رد الطرف الآخر.';
            booking.status = BookingStatus.TRIP_COMPLETED;
            booking.completedAt = booking.completedAt ?? new Date();
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

          // Same rule as a manual resolution: plan the gateway work here, run it after
          // the commit. The previous version wrote REFUNDED/RELEASED straight onto the
          // payment and never called Kashier at all, so the passenger was told their
          // money was on the way while the authorization quietly expired.
          settlement = this.planDisputeSettlement(booking.payment, isCash, resolution, 0);

          // Same bookkeeping as a manual ruling: a cash fare the passenger is owed back
          // is recorded on the payment so earnings stop counting it as the driver's.
          if (isCash && booking.payment && resolution === DisputeStatus.RESOLVED_REFUND) {
            booking.payment.refundAmount = Number(booking.payment.amount);
            booking.payment.refundedAt = new Date();
            await manager.save(Payment, booking.payment);
          }

          await manager.save(Booking, booking);

          dispute.status = resolution;
          dispute.resolutionNotes = outcomeText;
          dispute.resolvedAt = new Date();
          await manager.save(Dispute, dispute);

          const cashNote = isCash
            ? ' الرحلة كانت بالدفع النقدي، لذا تتم التسوية المالية بين الطرفين مباشرةً.'
            : '';

          setImmediate(() => {
            void this.notifications.sendToUsers(
              [dispute.openedByUserId, booking.trip.driverId, booking.passengerId].filter(
                (id, i, arr) => arr.indexOf(id) === i,
              ),
              {
                title: 'تم البت في النزاع تلقائياً',
                body: outcomeText + cashNote,
                data: { disputeId: dispute.id, screen: 'dispute_detail' },
              },
            );
          });
        });

        await this.settlement.settle(settlement, `dispute SLA ${dispute.id}`);
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
