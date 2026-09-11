import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Booking } from './booking.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  CAPTURED = 'captured',        // funds held in escrow
  RELEASED = 'released',        // released to driver wallet
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
  FAILED = 'failed',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id', unique: true })
  bookingId: string;

  @OneToOne(() => Booking, (booking) => booking.payment)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'currency', default: 'EGP', length: 3 })
  currency: string;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  // Gateway reference (Paymob / Fawry / etc.)
  @Column({ name: 'gateway_name', nullable: true, length: 30 })
  gatewayName: string;

  // Holds Kashier's *order* id (a UUID), which is the path parameter for
  // capture/void/refund. Despite the name it is not the transaction id.
  @Column({ name: 'gateway_transaction_id', nullable: true })
  gatewayTransactionId: string;

  // Kashier's transaction id (e.g. TX-249893963) — passed as
  // transaction.targetTransactionId when voiding or refunding a specific transaction.
  @Column({ name: 'kashier_transaction_id', nullable: true, type: 'varchar' })
  kashierTransactionId: string | null;

  @Column({ name: 'gateway_order_id', nullable: true })
  gatewayOrderId: string;

  // Kashier checkout session id — the key for reading payment status
  @Column({ name: 'gateway_session_id', nullable: true, type: 'varchar' })
  gatewaySessionId: string | null;

  @Column({ name: 'gateway_response', nullable: true, type: 'jsonb' })
  gatewayResponse: object;

  // Cash payment flag — no escrow; commission tracked separately
  @Column({ name: 'is_cash', default: false })
  isCash: boolean;

  @Column({ name: 'captured_at', nullable: true, type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'released_at', nullable: true, type: 'timestamptz' })
  releasedAt: Date;

  @Column({ name: 'refunded_at', nullable: true, type: 'timestamptz' })
  refundedAt: Date;

  @Column({ name: 'refund_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  refundAmount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
