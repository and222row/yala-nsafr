import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymobService } from './paymob.service';
import { KashierService } from './kashier.service';
import { KashierController } from './kashier.controller';
import { StripeService } from './stripe.service';
import { StripeController } from './stripe.controller';
import { Booking } from '../../database/entities/booking.entity';
import { Payment } from '../../database/entities/payment.entity';
import { Trip } from '../../database/entities/trip.entity';
import { WithdrawalRequest } from '../../database/entities/withdrawal-request.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Payment, Trip, WithdrawalRequest]), NotificationsModule],
  controllers: [StripeController, KashierController],
  providers: [PaymobService, KashierService, StripeService],
  exports: [PaymobService, KashierService, StripeService],
})
export class PaymentsModule {}
