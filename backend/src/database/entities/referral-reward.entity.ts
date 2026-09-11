import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('referral_rewards')
export class ReferralReward {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ name: 'referrer_id' }) referrerId: string;

  @Column({ name: 'referred_user_id', unique: true }) referredUserId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 }) amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
