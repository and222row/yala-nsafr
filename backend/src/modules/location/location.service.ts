import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TripLocation } from '../../database/entities/trip-location.entity';
import { Trip, TripStatus } from '../../database/entities/trip.entity';
import { Booking, PARTICIPANT_BOOKING_STATUSES } from '../../database/entities/booking.entity';
import { PostLocationDto } from './dto/post-location.dto';

@Injectable()
export class LocationService {
  constructor(
    @InjectRepository(TripLocation)
    private readonly locationRepo: Repository<TripLocation>,
    @InjectRepository(Trip)
    private readonly tripRepo: Repository<Trip>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  async recordLocation(tripId: string, userId: string, dto: PostLocationDto): Promise<TripLocation> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverId !== userId) throw new ForbiddenException('You are not the driver of this trip');
    if (trip.status !== TripStatus.ACTIVE) throw new BadRequestException('Trip is not active');

    const loc = this.locationRepo.create({
      tripId,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
    return this.locationRepo.save(loc);
  }

  async getLatestLocation(tripId: string, userId: string): Promise<TripLocation | null> {
    await this.assertAccess(tripId, userId);
    return this.locationRepo.findOne({
      where: { tripId },
      order: { recordedAt: 'DESC' },
    });
  }

  /** Full GPS trail — intended for admin dispute review */
  async getTrail(tripId: string): Promise<TripLocation[]> {
    return this.locationRepo.find({
      where: { tripId },
      order: { recordedAt: 'ASC' },
    });
  }

  private async assertAccess(tripId: string, userId: string): Promise<void> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.driverId === userId) return;

    const booking = await this.bookingRepo.findOne({
      where: {
        tripId,
        passengerId: userId,
        status: In(PARTICIPANT_BOOKING_STATUSES),
      },
    });
    if (!booking) throw new ForbiddenException('Not authorized to view this trip location');
  }
}
