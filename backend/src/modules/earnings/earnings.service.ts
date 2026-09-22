import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Not, IsNull, MoreThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Booking, BookingStatus, PaymentMethod } from '../../database/entities/booking.entity';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import {
  WithdrawalRequest,
  WithdrawalStatus,
  PayoutMethod,
} from '../../database/entities/withdrawal-request.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { KashierService } from '../payments/kashier.service';

const MIN_WITHDRAWAL = 200;

// How long a delivered payout is re-checked for a bounce-back. Kashier reports
// TRANSFERRED transfers as openForReturn indefinitely, so this bounds the watch
// rather than polling every payout forever.
const RETURN_WATCH_DAYS = 7;

@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRepo: Repository<WithdrawalRequest>,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly kashier: KashierService,
  ) {}

  async getSummary(driverId: string) {
    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoin('b.trip', 't')
      .leftJoinAndSelect('b.payment', 'p')
      .where('t.driverId = :driverId', { driverId })
      .andWhere('b.status = :status', { status: BookingStatus.TRIP_COMPLETED })
      .getMany();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let thisMonthOnline = 0, thisMonthCash = 0;
    let allTimeOnline = 0,   allTimeCash = 0;

    for (const b of bookings) {
      const isCash = b.paymentMethod === PaymentMethod.CASH;
      const payout = Number(b.driverPayoutAmount ?? 0);
      const total  = Number(b.totalAmount ?? 0);
      const completionDate = b.completedAt ?? b.updatedAt;
      const isThisMonth = completionDate && new Date(completionDate) >= startOfMonth;

      if (isCash) {
        // Cash is collected by the driver directly, so completion is enough
        allTimeCash += total;
        if (isThisMonth) thisMonthCash += total;
      } else if (b.payment?.status === PaymentStatus.CAPTURED) {
        // Only credit online payouts once the money is actually captured. A completed
        // trip whose capture failed or whose authorization lapsed collected nothing,
        // and paying out against it would send money we never received.
        allTimeOnline += payout;
        if (isThisMonth) thisMonthOnline += payout;
      } else if (b.payment?.status === PaymentStatus.PARTIALLY_REFUNDED) {
        // A split dispute ruling captures the fare and returns an agreed slice to the
        // passenger. The driver keeps the rest, so the payout is reduced by what went
        // back rather than dropping to zero — which is what happened while this status
        // was not counted at all.
        const net = Math.max(0, +(payout - Number(b.payment.refundAmount ?? 0)).toFixed(2));
        allTimeOnline += net;
        if (isThisMonth) thisMonthOnline += net;
      }
    }

    const withdrawals = await this.withdrawalRepo.find({
      where: [
        { driverId, status: WithdrawalStatus.PAID },
        { driverId, status: WithdrawalStatus.PENDING },
      ],
      select: { amount: true, status: true },
    });

    const sum = (status: WithdrawalStatus) =>
      withdrawals
        .filter((w) => w.status === status)
        .reduce((s, w) => s + Number(w.amount ?? 0), 0);

    const totalWithdrawn = sum(WithdrawalStatus.PAID);
    // A PENDING withdrawal is money already handed to Kashier and awaiting settlement.
    // It is not spendable, so it must come off the available balance — otherwise the
    // driver sees their full balance while a transfer of it is already in flight.
    const pendingWithdrawal = sum(WithdrawalStatus.PENDING);

    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      thisMonthOnline:   round(thisMonthOnline),
      thisMonthCash:     round(thisMonthCash),
      allTimeOnline:     round(allTimeOnline),
      allTimeCash:       round(allTimeCash),
      pendingBalance:    round(allTimeOnline - totalWithdrawn - pendingWithdrawal),
      totalWithdrawn:    round(totalWithdrawn),
      pendingWithdrawal: round(pendingWithdrawal),
      minWithdrawal:     MIN_WITHDRAWAL,
    };
  }

  async getTripBreakdown(driverId: string, page = 1) {
    const limit = 20;
    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .innerJoinAndSelect('b.trip', 't')
      .leftJoinAndSelect('b.payment', 'p')
      .where('t.driverId = :driverId', { driverId })
      .andWhere('b.status = :status', { status: BookingStatus.TRIP_COMPLETED })
      .orderBy('b.completedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return bookings.map((b) => ({
      bookingId:          b.id,
      tripId:             b.tripId,
      originCity:         b.trip.originCity,
      destinationCity:    b.trip.destinationCity,
      departureTime:      b.trip.departureTime,
      seatsCount:         b.seatsCount,
      totalAmount:        b.totalAmount,
      commissionAmount:   b.commissionAmount,
      driverPayoutAmount: b.driverPayoutAmount,
      paymentMethod:      b.paymentMethod,
      // Explains why a completed trip may not appear in the withdrawable balance:
      // online payouts only count once the payment reaches CAPTURED.
      paymentStatus:      b.payment?.status ?? null,
      completedAt:        b.completedAt,
    }));
  }

  async getWithdrawals(driverId: string) {
    return this.withdrawalRepo.find({
      where: { driverId },
      order: { createdAt: 'DESC' },
    });
  }

  async requestWithdrawal(
    driver: User,
    amount: number,
    payoutMethod: PayoutMethod,
    payoutAccount: string,
    payoutName: string,
    payoutBank?: string,
  ) {
    if (amount < MIN_WITHDRAWAL) {
      throw new BadRequestException(`الحد الأدنى للسحب ${MIN_WITHDRAWAL} جنيه`);
    }

    // Checking the balance and inserting the request have to be one atomic step. Read
    // then write with nothing in between let two simultaneous requests both pass the
    // balance and "no pending withdrawal" checks and both create a payout. Locking the
    // driver's own row serialises requests per driver without blocking anyone else: the
    // second waits for the first to commit, then sees the withdrawal it created.
    const saved = await this.dataSource.transaction(async (manager) => {
      await manager.findOne(User, {
        where: { id: driver.id },
        lock: { mode: 'pessimistic_write' },
      });

      const summary = await this.getSummary(driver.id);
      if (amount > summary.pendingBalance) {
        throw new BadRequestException('المبلغ المطلوب يتجاوز رصيدك المتاح');
      }

      const pending = await manager.count(WithdrawalRequest, {
        where: { driverId: driver.id, status: WithdrawalStatus.PENDING },
      });
      if (pending > 0) {
        throw new BadRequestException('لديك طلب سحب قيد المراجعة بالفعل');
      }

      return manager.save(
        WithdrawalRequest,
        manager.create(WithdrawalRequest, {
          driverId: driver.id,
          amount,
          payoutMethod,
          payoutAccount,
          payoutName,
          payoutBank,
        }),
      );
    });

    // Hand the transfer to Kashier. A returned transferId only means Kashier accepted
    // the request — the transfer settles asynchronously and can still end up FAILED, so
    // this stays PENDING until the payouts webhook confirms it (or an admin settles it).
    // Marking it PAID here would reduce the driver's balance for money never delivered.
    try {
      const { transferId } = await this.kashier.createTransfer({
        amount,
        method: this.kashier.toKashierMethod(payoutMethod),
        recipientName: payoutName,
        recipientNumber: payoutAccount,
        merchantTransferId: saved.id,
        recipientBank: payoutBank,
      });

      saved.kashierTransferId = transferId;
      await this.withdrawalRepo.save(saved);

      setImmediate(() =>
        void this.notifications.sendToUser(driver.id, {
          title: 'جاري تحويل أرباحك',
          body: `جاري تحويل ${amount} جنيه إلى ${payoutAccount}. سنبلغك فور اكتمال التحويل.`,
          data: { screen: 'earnings' },
        }),
      );
    } catch (err) {
      // Transfer failed — keep as PENDING for admin to investigate
      saved.adminNote = `Auto-transfer failed: ${err instanceof Error ? err.message : String(err)}`;
      await this.withdrawalRepo.save(saved);

      setImmediate(() =>
        void this.notifications.sendToUser(driver.id, {
          title: 'فشل التحويل',
          body: `تعذّر تحويل ${amount} جنيه تلقائياً. سيتواصل معك الفريق قريباً.`,
          data: { screen: 'earnings' },
        }),
      );
    }

    return saved;
  }

  /**
   * Kashier accepts a transfer, then settles it asynchronously. The payouts webhook is
   * supposed to report the outcome, but a webhook that is never delivered — or whose
   * payload shape we read wrongly — would strand a withdrawal at PENDING indefinitely.
   * This polls Kashier directly for anything still outstanding, so our records converge
   * on the gateway's view without depending on delivery.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcilePendingWithdrawals(): Promise<void> {
    if (this.kashier.isMock) return;

    // A TRANSFERRED payout stays returnable (openForReturn) — the receiving wallet can
    // bounce it back afterwards. So recently-paid withdrawals are re-checked too, not
    // just unsettled ones, otherwise a bounce would go unnoticed and the driver would
    // be left short.
    const watchSince = new Date(Date.now() - RETURN_WATCH_DAYS * 24 * 60 * 60 * 1000);
    const outstanding = await this.withdrawalRepo.find({
      where: [
        // Deliberately not filtered on kashierTransferId: a create call that timed out
        // leaves none, and those are exactly the withdrawals most in need of recovery.
        { status: WithdrawalStatus.PENDING },
        {
          status: WithdrawalStatus.PAID,
          kashierTransferId: Not(IsNull()),
          paidAt: MoreThan(watchSince),
        },
      ],
    });
    if (outstanding.length === 0) return;

    for (const withdrawal of outstanding) {
      let status: string | null;

      if (withdrawal.kashierTransferId) {
        status = await this.kashier.getTransferStatus(withdrawal.kashierTransferId);
      } else {
        // No transferId — ask Kashier using the id we sent as merchantTransferId. If it
        // has one, the create did land despite the timeout and we adopt it; if not, the
        // request never reached Kashier and the withdrawal stays pending for an admin.
        const recovered = await this.kashier.getTransferByMerchantId(withdrawal.id);
        if (!recovered) continue;

        withdrawal.kashierTransferId = recovered.transferId;
        await this.withdrawalRepo.save(withdrawal);
        this.logger.log(
          `Recovered transfer ${recovered.transferId} for withdrawal ${withdrawal.id}`,
        );
        status = recovered.status;
      }

      // Anything else (PENDING/INITIATED/IN_TRANSIT, or unreadable) waits for a later run
      if (status !== 'TRANSFERRED' && status !== 'FAILED') continue;

      const delivered = status === 'TRANSFERRED';

      // Already recorded as delivered and still delivered — nothing to do
      if (delivered && withdrawal.status === WithdrawalStatus.PAID) continue;
      if (delivered) {
        withdrawal.status = WithdrawalStatus.PAID;
        withdrawal.paidAt = new Date();
      } else {
        withdrawal.status = WithdrawalStatus.REJECTED;
        withdrawal.adminNote =
          `Reconciled ${new Date().toISOString()}: Kashier reports transfer ` +
          `${withdrawal.kashierTransferId} as FAILED. Amount returned to balance.`;
      }
      await this.withdrawalRepo.save(withdrawal);
      this.logger.log(
        `Reconciled withdrawal ${withdrawal.id}: Kashier=${status} → ${withdrawal.status}`,
      );

      setImmediate(() =>
        void this.notifications.sendToUser(withdrawal.driverId, {
          title: delivered ? 'تم تحويل أرباحك ✅' : 'فشل تحويل أرباحك',
          body: delivered
            ? `تم تحويل ${withdrawal.amount} جنيه إلى ${withdrawal.payoutAccount} بنجاح`
            : `تعذّر تحويل ${withdrawal.amount} جنيه. تم إرجاع المبلغ إلى رصيدك.`,
          data: { screen: 'earnings' },
        }),
      );
    }
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  async getPendingWithdrawals() {
    return this.withdrawalRepo.find({
      where: { status: WithdrawalStatus.PENDING },
      relations: { driver: true },
      order: { createdAt: 'ASC' },
    });
  }

  async settleWithdrawal(
    id: string,
    action: 'pay' | 'reject',
    adminNote?: string,
  ) {
    const req = await this.withdrawalRepo.findOne({
      where: { id },
      relations: { driver: true },
    });
    if (!req) throw new NotFoundException('Withdrawal request not found');
    if (req.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException('Request already settled');
    }

    req.status = action === 'pay' ? WithdrawalStatus.PAID : WithdrawalStatus.REJECTED;
    req.adminNote = adminNote ?? '';
    if (action === 'pay') req.paidAt = new Date();

    const saved = await this.withdrawalRepo.save(req);

    setImmediate(() => {
      const msg =
        action === 'pay'
          ? `تم تحويل ${req.amount} جنيه إلى حسابك بنجاح ✅`
          : `تم رفض طلب سحب ${req.amount} جنيه${adminNote ? ': ' + adminNote : ''}`;
      void this.notifications.sendToUser(req.driverId, {
        title: action === 'pay' ? 'تم تحويل أرباحك' : 'تم رفض طلب السحب',
        body: msg,
        data: { screen: 'driver_earnings' },
      });
    });

    return saved;
  }

  async getAdminCommissionSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allTime, thisMonth] = await Promise.all([
      this.bookingRepo
        .createQueryBuilder('b')
        .leftJoin('b.payment', 'p')
        .select('COALESCE(SUM(b.commission_amount), 0)', 'total')
        .addSelect(
          `COALESCE(SUM(CASE WHEN p.status IN ('${PaymentStatus.CAPTURED}', '${PaymentStatus.PARTIALLY_REFUNDED}') THEN b.commission_amount ELSE 0 END), 0)`,
          'captured',
        )
        .addSelect(
          `COALESCE(SUM(CASE WHEN p.status = '${PaymentStatus.PENDING}' THEN b.commission_amount ELSE 0 END), 0)`,
          'pending',
        )
        .where('b.status = :status', { status: BookingStatus.TRIP_COMPLETED })
        .getRawOne<{ total: string; captured: string; pending: string }>(),

      this.bookingRepo
        .createQueryBuilder('b')
        .select('COALESCE(SUM(b.commission_amount), 0)', 'total')
        .where('b.status = :status', { status: BookingStatus.TRIP_COMPLETED })
        .andWhere('b.completed_at >= :start', { start: startOfMonth })
        .getRawOne<{ total: string }>(),
    ]);

    return {
      totalCommission: parseFloat(allTime?.total ?? '0'),
      capturedCommission: parseFloat(allTime?.captured ?? '0'),
      pendingCommission: parseFloat(allTime?.pending ?? '0'),
      thisMonthCommission: parseFloat(thisMonth?.total ?? '0'),
    };
  }
}
