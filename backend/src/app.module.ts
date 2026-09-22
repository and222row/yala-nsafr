import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TripsModule } from './modules/trips/trips.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LocationModule } from './modules/location/location.module';
import { MessagesModule } from './modules/messages/messages.module';
import { EarningsModule } from './modules/earnings/earnings.module';
import { UploadModule } from './modules/upload/upload.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SosModule } from './modules/sos/sos.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get('database')!,
    }),
    AuthModule,
    UsersModule,
    TripsModule,
    BookingsModule,
    RatingsModule,
    AdminModule,
    NotificationsModule,
    DisputesModule,
    PaymentsModule,
    LocationModule,
    MessagesModule,
    EarningsModule,
    UploadModule,
    SubscriptionsModule,
    BlocksModule,
    SchedulerModule,
    SosModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
