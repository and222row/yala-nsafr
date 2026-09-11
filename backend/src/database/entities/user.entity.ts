import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Trip } from './trip.entity';
import { Booking } from './booking.entity';
import { Rating } from './rating.entity';
import { DriverWallet } from './driver-wallet.entity';

export enum UserRole {
  PASSENGER = 'passenger',
  DRIVER = 'driver',
  BOTH = 'both',
  ADMIN = 'admin',
}

export enum UserStatus {
  PENDING_VERIFICATION = 'pending_verification',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  BANNED = 'banned',
}

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'phone_number', length: 20 })
  phoneNumber: string;

  @Column({ name: 'full_name', length: 100 })
  fullName: string;

  @Column({ nullable: true, name: 'profile_photo_url' })
  profilePhotoUrl: string;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender: Gender;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.PASSENGER })
  role: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING_VERIFICATION })
  status: UserStatus;

  // ID verification
  @Column({ name: 'national_id_number', nullable: true, length: 14 })
  nationalIdNumber: string;

  @Column({ name: 'national_id_photo_url', nullable: true })
  nationalIdPhotoUrl: string;

  @Column({ name: 'id_verified', default: false })
  idVerified: boolean;

  @Column({ name: 'id_verified_at', nullable: true, type: 'timestamptz' })
  idVerifiedAt: Date;

  // Driver-specific
  @Column({ name: 'driving_licence_number', nullable: true, length: 20 })
  drivingLicenceNumber: string;

  @Column({ name: 'driving_licence_photo_url', nullable: true })
  drivingLicencePhotoUrl: string;

  @Column({ name: 'vehicle_make', nullable: true, length: 50 })
  vehicleMake: string;

  @Column({ name: 'vehicle_model', nullable: true, length: 50 })
  vehicleModel: string;

  @Column({ name: 'vehicle_year', nullable: true, type: 'smallint' })
  vehicleYear: number;

  @Column({ name: 'vehicle_color', nullable: true, length: 30 })
  vehicleColor: string;

  @Column({ name: 'vehicle_plate', nullable: true, length: 20 })
  vehiclePlate: string;

  @Column({ name: 'vehicle_photo_url', nullable: true })
  vehiclePhotoUrl: string;

  @Column({ name: 'driver_verified', default: false })
  driverVerified: boolean;

  // Ratings summary (denormalized for fast listing display)
  @Column({ name: 'rating_average', type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAverage: number;

  @Column({ name: 'rating_count', default: 0 })
  ratingCount: number;

  @Column({ name: 'completed_trips_as_driver', default: 0 })
  completedTripsAsDriver: number;

  @Column({ name: 'cancelled_trips_as_driver', default: 0 })
  cancelledTripsAsDriver: number;

  @Column({ name: 'completed_trips_as_passenger', default: 0 })
  completedTripsAsPassenger: number;

  // Trust & Safety
  @Column({ name: 'trust_flagged', default: false })
  trustFlagged: boolean;

  @Column({ name: 'dispute_count', default: 0 })
  disputeCount: number;

  // Emergency contact
  @Column({ name: 'emergency_contact_name', nullable: true, length: 100 })
  emergencyContactName: string;

  @Column({ name: 'emergency_contact_phone', nullable: true, length: 20 })
  emergencyContactPhone: string;

  // Preferences (for Phase 2 filtering)
  @Column({ name: 'allows_smoking', default: false })
  allowsSmoking: boolean;

  @Column({ name: 'allows_pets', default: false })
  allowsPets: boolean;

  // Referral program
  @Column({ name: 'referral_code', nullable: true, unique: true, length: 10 })
  referralCode: string;

  @Column({ name: 'referred_by_user_id', nullable: true })
  referredByUserId: string;

  @Column({ name: 'promo_balance', type: 'decimal', precision: 10, scale: 2, default: 0 })
  promoBalance: number;

  // Points (future use)
  @Column({ name: 'points_balance', default: 0 })
  pointsBalance: number;

  // Cancellation strike system
  @Column({ name: 'cancellation_strikes', default: 0 })
  cancellationStrikes: number;

  @Column({ name: 'cash_booking_restricted_until', nullable: true, type: 'timestamptz' })
  cashBookingRestrictedUntil: Date | null;

  @Column({ name: 'trip_posting_banned_until', nullable: true, type: 'timestamptz' })
  tripPostingBannedUntil: Date | null;

  @Column({ name: 'fcm_token', nullable: true })
  fcmToken: string;

  @Column({ name: 'preferred_language', default: 'ar', length: 5 })
  preferredLanguage: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => Trip, (trip) => trip.driver)
  tripsAsDriver: Trip[];

  @OneToMany(() => Booking, (booking) => booking.passenger)
  bookings: Booking[];

  @OneToMany(() => Rating, (rating) => rating.rater)
  ratingsGiven: Rating[];

  @OneToMany(() => Rating, (rating) => rating.ratee)
  ratingsReceived: Rating[];

  @OneToMany(() => DriverWallet, (wallet) => wallet.driver)
  wallet: DriverWallet;
}
