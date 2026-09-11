import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum WithdrawalStatus {
  PENDING = 'pending',
  PAID = 'paid',
  REJECTED = 'rejected',
}

export enum PayoutMethod {
  VODAFONE_CASH = 'vodafone_cash',
  INSTAPAY = 'instapay',
  BANK = 'bank',
}

@Entity('withdrawal_requests')
export class WithdrawalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ name: 'payout_method', type: 'enum', enum: PayoutMethod })
  payoutMethod: PayoutMethod;

  @Column({ name: 'payout_account', length: 50 })
  payoutAccount: string;

  @Column({
    type: 'enum',
    enum: WithdrawalStatus,
    default: WithdrawalStatus.PENDING,
  })
  status: WithdrawalStatus;

  @Column({ name: 'admin_note', nullable: true })
  adminNote: string;

  @Column({ name: 'payout_name', nullable: true })
  payoutName: string;

  @Column({ name: 'payout_bank', nullable: true })
  payoutBank: string;

  @Column({ name: 'kashier_transfer_id', nullable: true })
  kashierTransferId: string;

  @Column({ name: 'paid_at', nullable: true, type: 'timestamptz' })
  paidAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
