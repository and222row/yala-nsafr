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

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED_REFUND = 'resolved_refund',
  RESOLVED_RELEASE = 'resolved_release',
  RESOLVED_SPLIT = 'resolved_split',
  CLOSED = 'closed',
}

export enum DisputeReason {
  NO_SHOW_DRIVER = 'no_show_driver',
  NO_SHOW_PASSENGER = 'no_show_passenger',
  UNSAFE_DRIVING = 'unsafe_driving',
  WRONG_ROUTE = 'wrong_route',
  PAYMENT_MISMATCH = 'payment_mismatch',
  HARASSMENT = 'harassment',
  OTHER = 'other',
}

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'trip_id' })
  tripId: string;

  @Column({ name: 'opened_by_user_id' })
  openedByUserId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'opened_by_user_id' })
  openedBy: User;

  @Column({ name: 'reason', type: 'enum', enum: DisputeReason })
  reason: DisputeReason;

  @Column({ name: 'description', type: 'text' })
  description: string;

  @Column({ name: 'evidence_urls', type: 'jsonb', nullable: true })
  evidenceUrls: string[];

  @Column({ name: 'other_party_response', nullable: true, type: 'text' })
  otherPartyResponse: string;

  @Column({ name: 'other_party_evidence_urls', type: 'jsonb', nullable: true })
  otherPartyEvidenceUrls: string[];

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN })
  status: DisputeStatus;

  @Column({ name: 'assigned_admin_id', nullable: true })
  assignedAdminId: string;

  @Column({ name: 'resolution_notes', nullable: true, type: 'text' })
  resolutionNotes: string;

  // For split resolutions
  @Column({ name: 'refund_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  refundAmount: number;

  @Column({ name: 'resolved_at', nullable: true, type: 'timestamptz' })
  resolvedAt: Date;

  // SLA tracking
  @Column({ name: 'sla_deadline', nullable: true, type: 'timestamptz' })
  slaDeadline: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
