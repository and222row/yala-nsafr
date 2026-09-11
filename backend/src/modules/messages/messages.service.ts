import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TripMessage } from '../../database/entities/trip-message.entity';
import { Trip } from '../../database/entities/trip.entity';
import { Booking, PARTICIPANT_BOOKING_STATUSES } from '../../database/entities/booking.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(TripMessage)
    private readonly msgRepo: Repository<TripMessage>,
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertAccess(tripId: string, userId: string): Promise<Trip> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverId === userId) return trip;

    const booking = await this.bookingRepo.findOne({
      where: { tripId, passengerId: userId, status: In(PARTICIPANT_BOOKING_STATUSES) },
    });
    if (!booking) throw new ForbiddenException('You do not have access to this chat');
    return trip;
  }

  async getMessages(
    tripId: string,
    userId: string,
    after?: string,
  ): Promise<TripMessage[]> {
    await this.assertAccess(tripId, userId);

    const qb = this.msgRepo
      .createQueryBuilder('msg')
      .leftJoinAndSelect('msg.sender', 'sender')
      .where('msg.tripId = :tripId', { tripId })
      .orderBy('msg.createdAt', 'ASC')
      .take(100);

    if (after) {
      const afterDate = new Date(after);
      if (isNaN(afterDate.getTime())) throw new BadRequestException('Invalid after timestamp');
      qb.andWhere('msg.createdAt > :after', { after: afterDate });
    }

    return qb.getMany();
  }

  async sendMessage(tripId: string, user: User, body: string): Promise<TripMessage> {
    if (!body || body.trim().length === 0) {
      throw new BadRequestException('Message body is required');
    }
    if (body.length > 1000) {
      throw new BadRequestException('Message too long');
    }

    const trip = await this.assertAccess(tripId, user.id);

    const msg = this.msgRepo.create({ tripId, senderId: user.id, body: body.trim() });
    const saved = await this.msgRepo.save(msg);
    saved.sender = user;

    setImmediate(async () => {
      const bookings = await this.bookingRepo.find({
        where: { tripId, status: In(PARTICIPANT_BOOKING_STATUSES) },
        select: { passengerId: true },
      });
      const passengerIds = bookings.map((b) => b.passengerId);
      const allIds = [trip.driverId, ...passengerIds];
      const otherIds = allIds.filter((id) => id !== user.id);

      if (otherIds.length > 0) {
        const senderName = user.fullName || user.phoneNumber;
        const preview = body.length > 60 ? body.substring(0, 60) + '…' : body;
        void this.notifications.sendToUsers(otherIds, {
          title: `رسالة من ${senderName}`,
          body: preview,
          data: { tripId, type: 'chat', screen: 'trip_chat' },
        });
      }
    });

    return saved;
  }
}
