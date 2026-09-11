import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';
import { Booking } from '../../database/entities/booking.entity';
import { WithdrawalRequest } from '../../database/entities/withdrawal-request.entity';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, WithdrawalRequest]), PaymentsModule],
  controllers: [EarningsController],
  providers: [EarningsService],
})
export class EarningsModule {}
