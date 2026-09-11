import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum WalletTransactionType {
  COMMISSION_CREDIT = 'commission_credit',   // trip completed, net payout credited
  CASH_COMMISSION_DEBIT = 'cash_commission_debit', // commission owed on a cash trip
  WITHDRAWAL = 'withdrawal',
  ADJUSTMENT = 'adjustment',                 // admin correction
}

@Entity('driver_wallet')
export class DriverWallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => User, (user) => user.wallet)
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  // Balance earmarked to cover future cash-trip commissions
  @Column({ name: 'cash_commission_balance', type: 'decimal', precision: 12, scale: 2, default: 0 })
  cashCommissionBalance: number;

  @Column({ name: 'transaction_type', type: 'enum', enum: WalletTransactionType })
  transactionType: WalletTransactionType;

  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'booking_id', nullable: true })
  bookingId: string;

  @Column({ name: 'notes', nullable: true })
  notes: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
