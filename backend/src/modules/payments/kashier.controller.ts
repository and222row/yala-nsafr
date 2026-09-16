import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KashierService } from './kashier.service';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { Booking, BookingStatus } from '../../database/entities/booking.entity';
import { Trip } from '../../database/entities/trip.entity';
import { WithdrawalRequest, WithdrawalStatus } from '../../database/entities/withdrawal-request.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Controller('kashier')
export class KashierController {
  private readonly logger = new Logger(KashierController.name);

  constructor(
    private readonly kashierService: KashierService,
    private readonly notifications: NotificationsService,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Trip) private readonly tripRepo: Repository<Trip>,
    @InjectRepository(WithdrawalRequest) private readonly withdrawalRepo: Repository<WithdrawalRequest>,
  ) {}

  // Browser redirect landing page after Kashier payment (shown in WebView / external browser)
  // Kashier appends: ?orderId=...&status=SUCCESS&merchantOrderId=...
  @Get('payment-done')
  async paymentDone(@Query() query: Record<string, string>, @Res() res: Response) {
    const merchantOrderId = query['merchantOrderId'] ?? query['orderId'];
    const status = String(query['status'] ?? '').toUpperCase();
    this.logger.log(`payment-done redirect: ${JSON.stringify(query)}`);

    if (merchantOrderId) {
      try {
        const payment = await this.paymentRepo.findOne({ where: { gatewayOrderId: merchantOrderId } });
        if (payment) {
          // Store Kashier's internal orderId so getOrderStatus can use it later
          const kashierInternalId = query['orderId'];
          if (kashierInternalId && kashierInternalId !== merchantOrderId) {
            payment.gatewayTransactionId = kashierInternalId;
          }
          // This endpoint is public and unauthenticated — it has to be, because Kashier
          // redirects the customer's browser here. The query string is therefore
          // attacker-controlled: anyone could request it with status=SUCCESS for someone
          // else's order. Ask Kashier what actually happened instead of believing it.
          const verified = await this.kashierService.getPaymentStatus(payment.gatewaySessionId);
          const reallyPaid = verified === 'AUTHORIZED' || verified === 'CAPTURED' || verified === 'SUCCESS';

          if ((status === 'SUCCESS' || status === 'AUTHORIZED') && !reallyPaid) {
            this.logger.warn(
              `payment-done claimed ${status} for ${merchantOrderId} but Kashier reports ` +
                `${verified ?? 'unknown'} — ignoring`,
            );
          }

          if (reallyPaid) {
            const booking = await this.bookingRepo.findOne({ where: { id: payment.bookingId } });
            if (booking && booking.status === BookingStatus.PENDING_PAYMENT) {
              payment.status = PaymentStatus.PENDING;
              await this.paymentRepo.save(payment);
              booking.status = BookingStatus.PENDING_DRIVER_APPROVAL;
              await this.bookingRepo.save(booking);
              this.logger.log(`payment-done redirect healed booking ${booking.id}`);
              const trip = await this.tripRepo.findOne({ where: { id: booking.tripId } });
              if (trip?.driverId) {
                setImmediate(() => void this.notifications.sendToUser(trip.driverId, {
                  title: 'طلب حجز جديد 🎉',
                  body: `راكب دفع ${booking.totalAmount} ج وينتظر موافقتك`,
                  data: { screen: 'driver_bookings', tripId: booking.tripId },
                }));
              }
            } else {
              // Still save the kashierTransactionId even if status isn't right yet
              await this.paymentRepo.save(payment);
            }
          } else {
            await this.paymentRepo.save(payment);
          }
        }
      } catch (e) {
        this.logger.error(`payment-done redirect heal error: ${String(e)}`);
      }
    }

    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تم الدفع</title>
<style>body{font-family:sans-serif;text-align:center;padding:60px 24px;background:#f9fafb}
h2{color:#16a34a;font-size:2rem;margin-bottom:12px}p{color:#555;font-size:1.1rem}
.btn{display:inline-block;margin-top:32px;padding:14px 32px;background:#16a34a;color:#fff;border-radius:12px;text-decoration:none;font-size:1rem}</style></head>
<body><h2>✅ تم الدفع بنجاح</h2>
<p>يمكنك الآن العودة إلى التطبيق — سيتم تأكيد الحجز تلقائياً</p>
<a href="intent://back#Intent;end" class="btn">العودة للتطبيق</a>
</body></html>`);
  }

  // Called by Kashier when a transaction changes state.
  // Body shape is { event, data } — the transaction detail lives under `data`, and
  // `event` alone is NOT a success signal: a failed operation arrives with the same
  // event and data.status = "FAILURE". Branch on data.status.
  @Post('webhooks/transaction')
  async transactionWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-kashier-signature') signature: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const event = String(body['event'] ?? '');
    const data = (body['data'] ?? {}) as Record<string, unknown>;
    this.logger.log(`Kashier webhook event=${event}: ${JSON.stringify(data)}`);

    const merchantOrderId = String(data['merchantOrderId'] ?? '');
    const kashierOrderId = String(data['kashierOrderId'] ?? '');
    const transactionId = String(data['transactionId'] ?? '');
    const status = String(data['status'] ?? '').toUpperCase();

    if (!merchantOrderId) {
      this.logger.warn(`Webhook carried no data.merchantOrderId — ignoring. event=${event}`);
      res.status(200);
      return;
    }

    // Deliberately NOT a 200. Kashier treats 200 and 409 as acknowledgement and stops
    // retrying, so acking an event we could not verify would discard it permanently —
    // and a misconfigured key would silently destroy every webhook instead of failing
    // visibly. A 401 costs at most 10 bounded retries and shows up in Kashier's
    // delivery records.
    if (!this.kashierService.verifyWebhookSignature(data, signature)) {
      this.logger.error(
        `Invalid webhook signature for order ${merchantOrderId}. ` +
          `header=${signature ?? '(none)'} payload=${this.kashierService.buildWebhookSignaturePayload(data) ?? '(no signatureKeys)'}`,
      );
      res.status(401);
      return;
    }

    // Also retryable: the webhook can legitimately arrive before our own commit lands
    const payment = await this.paymentRepo.findOne({ where: { gatewayOrderId: merchantOrderId } });
    if (!payment) {
      this.logger.warn(`No payment found for merchantOrderId ${merchantOrderId}`);
      res.status(404);
      return;
    }

    const booking = await this.bookingRepo.findOne({ where: { id: payment.bookingId } });
    if (!booking) {
      res.status(404);
      return;
    }

    // Record the identifiers needed by later capture/void/refund calls
    if (kashierOrderId) payment.gatewayTransactionId = kashierOrderId;
    if (transactionId) payment.kashierTransactionId = transactionId;
    payment.gatewayResponse = body as any;

    const nextStatus = this.paymentStatusFor(event, status);
    const succeeded = status === 'SUCCESS';

    // Only a failed charge invalidates the booking. A failed refund or void concerns a
    // booking that was already paid for.
    const chargeFailed =
      event === 'reject' ||
      (status === 'FAILURE' && (event === 'pay' || event === 'authorize'));

    const advancesBooking =
      succeeded &&
      (event === 'authorize' || event === 'pay') &&
      booking.status === BookingStatus.PENDING_PAYMENT;
    const cancelsBooking =
      chargeFailed && booking.status === BookingStatus.PENDING_PAYMENT;
    const changesPayment = nextStatus !== null && payment.status !== nextStatus;

    // Idempotency: Kashier retries up to 10 times and replays events, and 409 tells it
    // to stop. Only treat this as a replay when there is genuinely nothing left to
    // apply — comparing payment status alone would swallow the very first `authorize`,
    // because a new online payment already starts out PENDING.
    if (!changesPayment && !advancesBooking && !cancelsBooking) {
      await this.paymentRepo.save(payment);
      this.logger.log(`Webhook ${event}/${status} for ${merchantOrderId} already applied`);
      res.status(409);
      return;
    }

    if (nextStatus) payment.status = nextStatus;
    if (nextStatus === PaymentStatus.CAPTURED) payment.capturedAt = new Date();
    if (nextStatus === PaymentStatus.RELEASED) payment.releasedAt = new Date();
    if (nextStatus === PaymentStatus.REFUNDED) payment.refundedAt = new Date();
    await this.paymentRepo.save(payment);

    if (succeeded && (event === 'authorize' || event === 'pay')) {
      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        booking.status = BookingStatus.PENDING_DRIVER_APPROVAL;
        await this.bookingRepo.save(booking);
        this.logger.log(`Booking ${booking.id} paid (${event}) → awaiting driver`);

        const trip = await this.tripRepo.findOne({ where: { id: booking.tripId } });
        if (trip?.driverId) {
          setImmediate(() => void this.notifications.sendToUser(trip.driverId, {
            title: 'طلب حجز جديد 🎉',
            body: `راكب دفع ${booking.totalAmount} ج وينتظر موافقتك`,
            data: { screen: 'driver_bookings', tripId: booking.tripId },
          }));
        }
      }
    } else if (chargeFailed) {
      if (booking.status === BookingStatus.PENDING_PAYMENT) {
        booking.status = BookingStatus.CANCELLED_BY_PASSENGER;
        booking.cancellationReason = 'Payment failed';
        booking.cancelledAt = new Date();
        await this.bookingRepo.save(booking);

        await this.tripRepo
          .createQueryBuilder()
          .update(Trip)
          .set({ availableSeats: () => `available_seats + ${booking.seatsCount}` })
          .where('id = :id', { id: booking.tripId })
          .execute();

        this.logger.log(`Booking ${booking.id} payment failed — seats restored`);
      }
    }

    res.status(200);
  }

  // Maps a Kashier event + transaction status onto our payment state.
  // Returns null when the event carries no state change for us.
  private paymentStatusFor(event: string, status: string): PaymentStatus | null {
    if (status === 'FAILURE' || event === 'reject') {
      // Only the charge itself failing makes the payment FAILED. A failed refund, void
      // or capture leaves the original charge exactly as it was — marking the whole
      // payment FAILED there would erase a capture that really did succeed.
      return event === 'pay' || event === 'authorize' || event === 'reject'
        ? PaymentStatus.FAILED
        : null;
    }
    if (status !== 'SUCCESS') return null;

    switch (event) {
      case 'authorize':       return PaymentStatus.PENDING;   // funds held, not taken
      case 'pay':
      case 'capture':         return PaymentStatus.CAPTURED;
      case 'void':            return PaymentStatus.RELEASED;
      case 'refund':
      case 'reversal':        return PaymentStatus.REFUNDED;
      case 'partial_refund':  return PaymentStatus.PARTIALLY_REFUNDED;
      default:                return null;
    }
  }

  // Called by Kashier when a transfer (driver payout) status changes
  @Post('webhooks/transfer')
  async transferWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-kashier-signature') signature: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.logger.log(`Kashier transfer webhook: ${JSON.stringify(body)}`);

    const merchantTransferId = body['merchantTransferId'] as string;
    const transferId = body['transferId'] as string;
    const status = String(body['status'] ?? '').toUpperCase();
    const openForReturn = Boolean(body['openForReturn']);

    // Nothing a retry could fix on a malformed body, so this one is acknowledged
    if (!merchantTransferId) {
      res.status(200);
      return { received: true };
    }

    // Unverified, this endpoint would let anyone mark a withdrawal PAID or FAILED.
    // Note this uses the payout verifier, not the payment one — Kashier signs the two
    // differently and a shared verifier silently rejects every payout webhook.
    //
    // Answered with 401, not 200: Kashier stops retrying on 200/409, so acknowledging
    // an event we could not verify would destroy it. That matters most while
    // KASHIER_TRANSFER_API_KEY is unset, when verification cannot succeed at all.
    if (!this.kashierService.verifyTransferWebhookSignature(body, signature)) {
      this.logger.error(
        `Invalid payout webhook signature for ${merchantTransferId}. ` +
          `header=${signature ?? '(none)'} ` +
          `payload=${this.kashierService.buildTransferSignaturePayload(body) ?? '(no signatureKeys)'}`,
      );
      res.status(401);
      return { received: false };
    }

    const withdrawal = await this.withdrawalRepo.findOne({ where: { id: merchantTransferId } });
    if (!withdrawal) {
      // Retryable: the initiation webhook can outrun our own commit
      res.status(404);
      return { received: false };
    }

    if (transferId) withdrawal.kashierTransferId = transferId;

    // openForReturn stays true on a delivered payout, so it can't gate marking this
    // PAID — the driver has the money. reconcilePendingWithdrawals re-checks recently
    // paid transfers to catch a later bounce-back.
    if (openForReturn) {
      this.logger.log(`Withdrawal ${merchantTransferId} is ${status} and still returnable`);
    }

    if (status === 'TRANSFERRED') {
      withdrawal.status = WithdrawalStatus.PAID;
      withdrawal.paidAt = new Date();
      this.logger.log(`Withdrawal ${merchantTransferId} transferred successfully`);
    } else if (status === 'FAILED') {
      // Leave the amount out of totalWithdrawn — the driver never received it, so the
      // balance must go back to them rather than being silently written off.
      withdrawal.status = WithdrawalStatus.REJECTED;
      withdrawal.adminNote = `Kashier transfer failed: ${JSON.stringify(body)}`;
      this.logger.warn(`Withdrawal ${merchantTransferId} transfer failed`);
    }

    await this.withdrawalRepo.save(withdrawal);

    // requestWithdrawal only promises the transfer is under way, so the outcome has to
    // be reported here or the driver never learns it landed.
    if (status === 'TRANSFERRED' || status === 'FAILED') {
      const paid = status === 'TRANSFERRED';
      setImmediate(() => void this.notifications.sendToUser(withdrawal.driverId, {
        title: paid ? 'تم تحويل أرباحك ✅' : 'فشل تحويل أرباحك',
        body: paid
          ? `تم تحويل ${withdrawal.amount} جنيه إلى ${withdrawal.payoutAccount} بنجاح`
          : `تعذّر تحويل ${withdrawal.amount} جنيه. تم إرجاع المبلغ إلى رصيدك وسيتواصل معك الفريق.`,
        data: { screen: 'earnings' },
      }));
    }

    return { received: true };
  }
}
