import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { SosAlert } from '../../database/entities/sos-alert.entity';
import { Trip } from '../../database/entities/trip.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { Booking, PARTICIPANT_BOOKING_STATUSES } from '../../database/entities/booking.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateSosDto } from './dto/create-sos.dto';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);

  constructor(
    @InjectRepository(SosAlert)
    private readonly sosRepo: Repository<SosAlert>,
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly notifications: NotificationsService,
  ) {}

  async trigger(userId: string, tripId: string, dto: CreateSosDto): Promise<SosAlert> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');

    // Verify the user is a participant on the trip
    const isDriver = trip.driverId === userId;
    if (!isDriver) {
      const booking = await this.bookingRepo.findOne({
        where: { tripId, passengerId: userId, status: In(PARTICIPANT_BOOKING_STATUSES) },
      });
      if (!booking) throw new ForbiddenException('You are not part of this trip');
    }

    const alert = await this.sosRepo.save(
      this.sosRepo.create({
        userId,
        tripId,
        lat: dto.lat,
        lng: dto.lng,
        message: dto.message,
      }),
    );

    this.logger.warn(`SOS triggered by user ${userId} on trip ${tripId}`);

    // Notify driver (non-blocking, skip if the triggerer is the driver)
    if (!isDriver) {
      setImmediate(() => {
        void this.notifications.sendToUser(trip.driverId, {
          title: '🚨 SOS — طوارئ',
          body: 'أحد ركابك طلب الطوارئ! تحقق من التطبيق فوراً.',
          data: { screen: 'trip_detail', tripId, alertId: alert.id },
        });
      });
    }

    // Notify all admins (non-blocking)
    setImmediate(async () => {
      const admins = await this.userRepo.find({ where: { role: UserRole.ADMIN } });
      const adminIds = admins.map((a) => a.id);
      if (adminIds.length > 0) {
        void this.notifications.sendToUsers(adminIds, {
          title: '🚨 SOS في رحلة',
          body: `تنبيه طوارئ من مستخدم في رحلة ${trip.originCity} ← ${trip.destinationCity}`,
          data: { screen: 'admin_sos', alertId: alert.id, tripId },
        });
      }
    });

    return alert;
  }

  async resolve(alertId: string): Promise<SosAlert> {
    const alert = await this.sosRepo.findOneBy({ id: alertId });
    if (!alert) throw new NotFoundException('SOS alert not found');
    alert.resolvedAt = new Date();
    return this.sosRepo.save(alert);
  }

  async listPending(): Promise<SosAlert[]> {
    return this.sosRepo.find({
      where: { resolvedAt: IsNull() },
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
  }
}
