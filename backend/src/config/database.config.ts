import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { Trip } from '../database/entities/trip.entity';
import { Booking } from '../database/entities/booking.entity';
import { Payment } from '../database/entities/payment.entity';
import { Rating } from '../database/entities/rating.entity';
import { DriverWallet } from '../database/entities/driver-wallet.entity';
import { Dispute } from '../database/entities/dispute.entity';
import { Otp } from '../database/entities/otp.entity';
import { PlatformConfig } from '../database/entities/platform-config.entity';
import { TripLocation } from '../database/entities/trip-location.entity';
import { TripComment } from '../database/entities/trip-comment.entity';
import { TripMessage } from '../database/entities/trip-message.entity';
import { WithdrawalRequest } from '../database/entities/withdrawal-request.entity';
import { AppNotification } from '../database/entities/notification.entity';
import { ReferralReward } from '../database/entities/referral-reward.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { Block } from '../database/entities/block.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { SosAlert } from '../database/entities/sos-alert.entity';

export default registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'yala_nsafr',
  username: process.env.DB_USER || 'yala_user',
  password: process.env.DB_PASS || 'yala_pass',
  entities: [
    User, Trip, Booking, Payment, Rating, DriverWallet, Dispute, Otp,
    PlatformConfig, TripLocation, TripComment, TripMessage, WithdrawalRequest,
    AppNotification, ReferralReward, RefreshToken, Block, Subscription, SosAlert,
  ],
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.NODE_ENV === 'development',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
}));
