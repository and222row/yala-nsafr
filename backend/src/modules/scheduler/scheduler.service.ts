import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, Between, IsNull } from 'typeorm';
import { Trip, TripStatus } from '../../database/entities/trip.entity';
import { Booking, BookingStatus } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Runs every 5 minutes ────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleTripLifecycle() {
    await Promise.all([
      this.sendPreDepartureReminders(),
      this.sendFinalWarnings(),
      this.autoCancelOverdueTrips(),
    ]);
  }

  // ── T-30 min reminder ───────────────────────────────────────────────────────
  // Finds scheduled trips departing within the next 32 minutes with no reminder sent yet.

  private async sendPreDepartureReminders() {
    const now = new Date();
    const window = new Date(now.getTime() + 32 * 60_000);

    const trips = await this.tripRepo.find({
      where: {
        status: TripStatus.SCHEDULED,
        departureTime: Between(now, window),
        reminderSentAt: IsNull(),
      },
      relations: { driver: true },
    });

    for (const trip of trips) {
      const route = `${trip.originCity} ← ${trip.destinationCity}`;
      const timeLabel = this._fmtTime(trip.departureTime);

      // Notify driver
      setImmediate(() =>
        void this.notifications.sendToUser(trip.driverId, {
          title: 'رحلتك تبدأ خلال 30 دقيقة 🚗',
          body: `${route} — الساعة ${timeLabel}. تأكد من جاهزيتك.`,
          data: { screen: 'trip_detail', tripId: trip.id },
        }),
      );

      // Notify all confirmed passengers
      const passengerIds = await this._confirmedPassengerIds(trip.id);
      if (passengerIds.length > 0) {
        setImmediate(() =>
          void this.notifications.sendToUsers(passengerIds, {
            title: 'رحلتك تبدأ خلال 30 دقيقة ⏰',
            body: `${route} — الساعة ${timeLabel}. كن مستعداً.`,
            data: { screen: 'my_bookings' },
          }),
        );
      }

      trip.reminderSentAt = new Date();
      await this.tripRepo.save(trip);
      this.logger.log(`T-30 reminder sent for trip ${trip.id}`);
    }
  }

  // ── T+30 final warning ──────────────────────────────────────────────────────
  // Finds trips that should have departed 28+ minutes ago, still not started, no warning sent.

  private async sendFinalWarnings() {
    const threshold = new Date(Date.now() - 28 * 60_000);

    const trips = await this.tripRepo.find({
      where: {
        status: TripStatus.SCHEDULED,
        departureTime: LessThan(threshold),
        finalWarningSentAt: IsNull(),
      },
    });

    for (const trip of trips) {
      const route = `${trip.originCity} ← ${trip.destinationCity}`;

      setImmediate(() =>
        void this.notifications.sendToUser(trip.driverId, {
          title: '⚠️ لم تبدأ رحلتك بعد',
          body: `رحلة ${route} تأخرت. لديك 15 دقيقة لبدء الرحلة وإلا ستُلغى تلقائياً وتُسترد مبالغ الركاب.`,
          data: { screen: 'trip_detail', tripId: trip.id },
        }),
      );

      trip.finalWarningSentAt = new Date();
      await this.tripRepo.save(trip);
      this.logger.log(`Final warning sent for trip ${trip.id}`);
    }
  }

  // ── T+45 auto-cancel ────────────────────────────────────────────────────────
  // Finds trips 43+ minutes past departure, still scheduled → auto-cancel with full refund.

  private async autoCancelOverdueTrips() {
    const threshold = new Date(Date.now() - 43 * 60_000);

    const trips = await this.tripRepo.find({
      where: {
        status: TripStatus.SCHEDULED,
        departureTime: LessThan(threshold),
      },
    });

    for (const trip of trips) {
      try {
        await this._autoCancelTrip(trip);
      } catch (e) {
        this.logger.error(`Auto-cancel failed for trip ${trip.id}: ${String(e)}`);
      }
    }
  }

  private async _autoCancelTrip(trip: Trip) {
    const route = `${trip.originCity} ← ${trip.destinationCity}`;

    await this.dataSource.transaction(async (manager) => {
      const fresh = await manager.findOne(Trip, { where: { id: trip.id } });
      if (!fresh || fresh.status !== TripStatus.SCHEDULED) return;

      const bookings = await manager.find(Booking, {
        where: [
          { tripId: trip.id, status: BookingStatus.CONFIRMED },
          { tripId: trip.id, status: BookingStatus.IN_PROGRESS },
          { tripId: trip.id, status: BookingStatus.PENDING_DRIVER_APPROVAL },
          { tripId: trip.id, status: BookingStatus.PENDING_PAYMENT },
        ],
        relations: { payment: true },
      });

      const passengerIds: string[] = [];
      for (const booking of bookings) {
        if (booking.payment && !booking.payment.isCash) {
          if (booking.payment.status === PaymentStatus.CAPTURED) {
            booking.payment.status = PaymentStatus.REFUNDED;
            booking.payment.refundedAt = new Date();
            booking.payment.refundAmount = booking.payment.amount;
            await manager.save(Payment, booking.payment);
          } else if (booking.payment.status === PaymentStatus.PENDING) {
            booking.payment.status = PaymentStatus.RELEASED;
            booking.payment.releasedAt = new Date();
            await manager.save(Payment, booking.payment);
          }
        }
        booking.status = BookingStatus.REFUNDED;
        booking.cancelledAt = new Date();
        booking.cancellationReason = 'تم إلغاء الرحلة تلقائياً لعدم البدء في الموعد المحدد';
        await manager.save(Booking, booking);
        passengerIds.push(booking.passengerId);
      }

      fresh.status = TripStatus.CANCELLED;
      fresh.cancelledAt = new Date();
      fresh.cancellationReason = 'إلغاء تلقائي — لم يبدأ السائق الرحلة';
      await manager.save(Trip, fresh);

      // Increment driver's cancelled-trips counter + apply repeat-offender policy
      await manager.increment(User, { id: fresh.driverId }, 'cancelledTripsAsDriver', 1);
      await manager.increment(User, { id: fresh.driverId }, 'cancellationStrikes', 1);

      const driverAfter = await manager.findOne(User, {
        where: { id: fresh.driverId },
        select: { id: true, cancellationStrikes: true },
      });
      const strikes = driverAfter?.cancellationStrikes ?? 0;

      if (strikes >= 10) {
        await manager.update(User, { id: fresh.driverId }, { status: UserStatus.SUSPENDED });
        setImmediate(() =>
          void this.notifications.sendToUser(fresh.driverId, {
            title: '🚫 تم تعليق حسابك',
            body: 'تم تعليق حسابك بشكل دائم بسبب الإلغاء المتكرر. تواصل مع الدعم.',
            data: { screen: 'my_trips' },
          }),
        );
      } else if (strikes >= 5) {
        const bannedUntil = new Date(Date.now() + 30 * 24 * 3_600_000);
        await manager.update(User, { id: fresh.driverId }, { tripPostingBannedUntil: bannedUntil });
        setImmediate(() =>
          void this.notifications.sendToUser(fresh.driverId, {
            title: '⚠️ تم تعليق نشر الرحلات 30 يوماً',
            body: `بسبب الإلغاء المتكرر، لن تتمكن من نشر رحلات لمدة 30 يوماً.`,
            data: { screen: 'my_trips' },
          }),
        );
      } else if (strikes >= 3) {
        const bannedUntil = new Date(Date.now() + 7 * 24 * 3_600_000);
        await manager.update(User, { id: fresh.driverId }, { tripPostingBannedUntil: bannedUntil });
        setImmediate(() =>
          void this.notifications.sendToUser(fresh.driverId, {
            title: '⚠️ تم تعليق نشر الرحلات 7 أيام',
            body: `هذه إنذار ${strikes} — تم تعليق حقك في نشر رحلات لمدة 7 أيام.`,
            data: { screen: 'my_trips' },
          }),
        );
      }

      this.logger.log(`Auto-cancelled trip ${trip.id} (driver ${trip.driverId})`);

      if (passengerIds.length > 0) {
        setImmediate(() =>
          void this.notifications.sendToUsers(passengerIds, {
            title: 'تم إلغاء رحلتك تلقائياً',
            body: `رحلة ${route} لم تنطلق في موعدها. سيتم استرداد مبلغك كاملاً خلال 24 ساعة.`,
            data: { screen: 'my_bookings' },
          }),
        );
      }

      // Warn the driver
      setImmediate(() =>
        void this.notifications.sendToUser(fresh.driverId, {
          title: 'تم إلغاء رحلتك تلقائياً',
          body: `رحلة ${route} أُلغيت لعدم البدء في الموعد. تجنب التكرار لأنه يؤثر على تقييمك.`,
          data: { screen: 'my_trips' },
        }),
      );
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async _confirmedPassengerIds(tripId: string): Promise<string[]> {
    const bookings = await this.bookingRepo.find({
      where: [
        { tripId, status: BookingStatus.CONFIRMED },
        { tripId, status: BookingStatus.IN_PROGRESS },
        { tripId, status: BookingStatus.PENDING_DRIVER_APPROVAL },
      ],
      select: { passengerId: true },
    });
    return [...new Set(bookings.map((b) => b.passengerId))];
  }

  private _fmtTime(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
}
