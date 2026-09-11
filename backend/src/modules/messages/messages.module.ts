import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { TripMessage } from '../../database/entities/trip-message.entity';
import { Trip } from '../../database/entities/trip.entity';
import { Booking } from '../../database/entities/booking.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TripMessage, Trip, Booking])],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
