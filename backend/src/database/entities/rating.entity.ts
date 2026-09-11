import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum RaterRole {
  DRIVER = 'driver',
  PASSENGER = 'passenger',
}

@Entity('ratings')
@Index(['tripId', 'raterId'], { unique: true })
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trip_id' })
  tripId: string;

  @Column({ name: 'booking_id' })
  bookingId: string;

  @Column({ name: 'rater_id' })
  raterId: string;

  @ManyToOne(() => User, (user) => user.ratingsGiven)
  @JoinColumn({ name: 'rater_id' })
  rater: User;

  @Column({ name: 'ratee_id' })
  rateeId: string;

  @ManyToOne(() => User, (user) => user.ratingsReceived)
  @JoinColumn({ name: 'ratee_id' })
  ratee: User;

  @Column({ name: 'rater_role', type: 'enum', enum: RaterRole })
  raterRole: RaterRole;

  @Column({ type: 'smallint' })
  score: number; // 1–5

  @Column({ nullable: true, type: 'text' })
  comment: string;

  // Blind rating: hidden until both sides rate or window closes
  @Column({ name: 'is_revealed', default: false })
  isRevealed: boolean;

  @Column({ name: 'reveal_after', type: 'timestamptz', nullable: true })
  revealAfter: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
