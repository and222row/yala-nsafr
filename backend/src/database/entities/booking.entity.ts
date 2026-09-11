import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { User } from './user.entity';
import { Trip } from './trip.entity';
import { Payment } from './payment.entity';

export enum BookingStatus {
  PENDING_PAYMENT = 'pending_payment',
  PENDING_DRIVER_APPROVAL = 'pending_driver_approval',
  CONFIRMED = 'confirmed',
  IN_PROGRESS = 'in_progress',
  TRIP_COMPLETED = 'trip_completed',
  CANCELLED_BY_PASSENGER = 'cancelled_by_passenger',
  CANCELLED_BY_DRIVER = 'cancelled_by_driver',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

// A passenger counts as a trip participant in these states. TRIP_COMPLETED is
// included so chat, comments, co-passengers, location and SOS keep working after
// the driver ends the trip — passengers still need them for lost items and disputes.
export const PARTICIPANT_BOOKING_STATUSES = [
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.TRIP_COMPLETED,
];

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  VODAFONE_CASH = 'vodafone_cash',
  INSTAPAY = 'instapay',
  FAWRY = 'fawry',
}

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trip_id' })
  tripId: string;

  @ManyToOne(() => Trip, (trip) => trip.bookings)
  @JoinColumn({ name: 'trip_id' })
  trip: Trip;

  @Column({ name: 'passenger_id' })
  passengerId: string;

  @ManyToOne(() => User, (user) => user.bookings)
  @JoinColumn({ name: 'passenger_id' })
  passenger: User;

  @Column({ name: 'seats_count', type: 'smallint', default: 1 })
  seatsCount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 10, scale: 2 })
  totalAmount: number;

  @Column({ name: 'commission_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  commissionAmount: number;

  @Column({ name: 'driver_payout_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  driverPayoutAmount: number;

  @Column({ name: 'promo_discount_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  promoDiscountAmount: number;

  @Column({ name: 'commission_rate', type: 'decimal', precision: 5, scale: 4 })
  commissionRate: number;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  paymentMethod: PaymentMethod;

  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.PENDING_DRIVER_APPROVAL })
  status: BookingStatus;

  // Confirmation times
  @Column({ name: 'confirmed_at', nullable: true, type: 'timestamptz' })
  confirmedAt: Date;

  @Column({ name: 'completed_at', nullable: true, type: 'timestamptz' })
  completedAt: Date;

  // Who confirmed completion
  @Column({ name: 'driver_confirmed_completion', default: false })
  driverConfirmedCompletion: boolean;

  @Column({ name: 'passenger_confirmed_completion', default: false })
  passengerConfirmedCompletion: boolean;

  // Auto-confirm if neither party disputes within this window
  @Column({ name: 'auto_confirm_after', nullable: true, type: 'timestamptz' })
  autoConfirmAfter: Date;

  @Column({ name: 'cancelled_at', nullable: true, type: 'timestamptz' })
  cancelledAt: Date;

  @Column({ name: 'cancellation_reason', nullable: true })
  cancellationReason: string;

  @Column({ name: 'dispute_id', nullable: true })
  disputeId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => Payment, (payment) => payment.booking)
  payment: Payment;
}
