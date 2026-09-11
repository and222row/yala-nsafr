import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Booking } from './booking.entity';

export enum TripStatus {
  SCHEDULED = 'scheduled',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id' })
  driverId: string;

  @ManyToOne(() => User, (user) => user.tripsAsDriver, { eager: false })
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  // Route
  @Index()
  @Column({ name: 'origin_city', length: 100 })
  originCity: string;

  @Column({ name: 'origin_address', nullable: true })
  originAddress: string;

  @Column({ name: 'origin_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  originLat: number;

  @Column({ name: 'origin_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  originLng: number;

  @Index()
  @Column({ name: 'destination_city', length: 100 })
  destinationCity: string;

  @Column({ name: 'destination_address', nullable: true })
  destinationAddress: string;

  @Column({ name: 'destination_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  destinationLat: number;

  @Column({ name: 'destination_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  destinationLng: number;

  @Index()
  @Column({ name: 'departure_time', type: 'timestamptz' })
  departureTime: Date;

  @Column({ name: 'estimated_arrival_time', type: 'timestamptz', nullable: true })
  estimatedArrivalTime: Date;

  @Column({ name: 'total_seats', type: 'smallint' })
  totalSeats: number;

  @Column({ name: 'available_seats', type: 'smallint' })
  availableSeats: number;

  @Column({ name: 'price_per_seat', type: 'decimal', precision: 10, scale: 2 })
  pricePerSeat: number;

  @Column({ type: 'enum', enum: TripStatus, default: TripStatus.SCHEDULED })
  status: TripStatus;

  // Egypt-specific
  @Column({ name: 'women_only', default: false })
  womenOnly: boolean;

  // Preferences
  @Column({ name: 'smoking_allowed', default: false })
  smokingAllowed: boolean;

  @Column({ name: 'pets_allowed', default: false })
  petsAllowed: boolean;

  @Column({ name: 'air_conditioning', default: false })
  airConditioning: boolean;

  @Column({ name: 'luggage_size', default: 'medium', length: 20 })
  luggageSize: string;

  @Column({ name: 'chat_preference', default: 'friendly', length: 20 })
  chatPreference: string;

  @Column({ name: 'notes', nullable: true, type: 'text' })
  notes: string;

  // Community (Phase 3)
  @Column({ name: 'community_id', nullable: true })
  communityId: string;

  // Live tracking (Phase 2)
  @Column({ name: 'current_lat', type: 'decimal', precision: 10, scale: 7, nullable: true })
  currentLat: number;

  @Column({ name: 'current_lng', type: 'decimal', precision: 10, scale: 7, nullable: true })
  currentLng: number;

  @Column({ name: 'tracking_updated_at', nullable: true, type: 'timestamptz' })
  trackingUpdatedAt: Date;

  @Column({ name: 'completed_at', nullable: true, type: 'timestamptz' })
  completedAt: Date;

  @Column({ name: 'cancelled_at', nullable: true, type: 'timestamptz' })
  cancelledAt: Date;

  @Column({ name: 'cancellation_reason', nullable: true })
  cancellationReason: string;

  // Scheduler: reminder sent ~30 min before departure
  @Column({ name: 'reminder_sent_at', nullable: true, type: 'timestamptz' })
  reminderSentAt: Date;

  // Scheduler: final warning sent ~30 min after scheduled departure (before auto-cancel)
  @Column({ name: 'final_warning_sent_at', nullable: true, type: 'timestamptz' })
  finalWarningSentAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Booking, (booking) => booking.trip)
  bookings: Booking[];
}
