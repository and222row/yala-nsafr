import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../../database/entities/payment.entity';
import { KashierService } from './kashier.service';

/**
 * What the gateway still has to do for a payment whose fate has already been decided
 * in the database. Built inside a transaction, executed after it commits.
 */
export type PaymentSettlement = {
  paymentId: string;
  /** Kashier order id — the transaction id when we have one, else the order id */
  orderId: string;
  /** The specific transaction on the order to act on, when known */
  targetTransactionId?: string;
  action: 'void' | 'capture' | 'capture_then_refund' | 'refund';
  captureAmount?: number;
  /** Amount to send to the gateway */
  refundAmount?: number;
  /**
   * Cumulative refunded total to store on the payment row. Defaults to `refundAmount`;
   * set it when refunding on top of an earlier partial refund, so the record shows the
   * running total rather than just the last slice.
   */
  recordRefundAmount?: number;
  fullRefund?: boolean;
};

/**
 * Performs the gateway side of a decision that has already been committed — a
 * cancellation, or a dispute an admin has ruled on.
 *
 * Two rules, both learned the hard way:
 *
 *  - The calls never run inside the deciding transaction. A late cancellation captures
 *    the fare and then refunds it; when a failing refund rolled that transaction back,
 *    the capture had already happened at Kashier and the passenger was charged with no
 *    record of it.
 *  - Each step is persisted the moment it succeeds. A capture followed by a failed
 *    refund is then recorded as captured-with-refund-owed, which reconciliation can
 *    find, instead of disappearing.
 *
 * A gateway failure is logged rather than thrown: the user's booking or dispute outcome
 * must not hinge on Kashier being reachable at that instant.
 */
@Injectable()
export class PaymentSettlementService {
  private readonly logger = new Logger(PaymentSettlementService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly kashier: KashierService,
  ) {}

  async settle(intent: PaymentSettlement | null, context = 'settlement'): Promise<void> {
    if (!intent) return;

    try {
      switch (intent.action) {
        case 'void':
          await this.kashier.releasePayment(intent.orderId, intent.targetTransactionId);
          await this.paymentRepo.update(intent.paymentId, {
            status: PaymentStatus.RELEASED,
            releasedAt: new Date(),
          });
          break;

        case 'capture': {
          const { transactionId } = await this.kashier.capturePayment(
            intent.orderId,
            intent.captureAmount!,
          );
          await this.paymentRepo.update(intent.paymentId, {
            status: PaymentStatus.CAPTURED,
            capturedAt: new Date(),
            ...(transactionId ? { kashierTransactionId: transactionId } : {}),
          });
          break;
        }

        case 'capture_then_refund': {
          const { transactionId } = await this.kashier.capturePayment(
            intent.orderId,
            intent.captureAmount!,
          );
          // Written before the refund is attempted: if that fails, the record still
          // shows the money was taken and a refund is outstanding.
          await this.paymentRepo.update(intent.paymentId, {
            status: PaymentStatus.CAPTURED,
            capturedAt: new Date(),
            ...(transactionId ? { kashierTransactionId: transactionId } : {}),
          });
          // Refund the capture we just made, rather than letting Kashier pick a
          // transaction on the order
          await this.kashier.refundPayment(
            intent.orderId,
            intent.refundAmount!,
            transactionId ?? undefined,
          );
          await this.paymentRepo.update(intent.paymentId, {
            status: intent.fullRefund
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
            refundAmount: intent.recordRefundAmount ?? intent.refundAmount,
            refundedAt: new Date(),
          });
          break;
        }

        case 'refund':
          await this.kashier.refundPayment(
            intent.orderId,
            intent.refundAmount!,
            intent.targetTransactionId,
          );
          await this.paymentRepo.update(intent.paymentId, {
            status: intent.fullRefund
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
            refundAmount: intent.recordRefundAmount ?? intent.refundAmount,
            refundedAt: new Date(),
          });
          break;
      }
    } catch (err) {
      this.logger.error(
        `Failed to settle payment ${intent.paymentId} (${context}, ${intent.action}): ${err}`,
      );
    }
  }
}
