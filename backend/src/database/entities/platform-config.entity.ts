import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('platform_config')
export class PlatformConfig {
  @PrimaryColumn({ name: 'key', length: 100 })
  key: string;

  @Column({ name: 'value', type: 'text' })
  value: string;

  @Column({ name: 'description', nullable: true })
  description: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// Config keys used across the platform
export const CONFIG_KEYS = {
  COMMISSION_RATE: 'commission_rate',
  AUTO_CONFIRM_HOURS: 'auto_confirm_hours',
  DISPUTE_WINDOW_HOURS: 'dispute_window_hours',
  RATING_REVEAL_DAYS: 'rating_reveal_days',
  LOW_RATING_THRESHOLD: 'low_rating_threshold',
  MIN_RATINGS_FOR_FLAG: 'min_ratings_for_flag',
  FREE_CANCEL_HOURS: 'free_cancel_hours',
  LATE_CANCEL_HOURS: 'late_cancel_hours',
  LATE_CANCEL_FEE_PCT: 'late_cancel_fee_pct',
  DRIVER_COMPENSATION_PCT: 'driver_compensation_pct',
} as const;
