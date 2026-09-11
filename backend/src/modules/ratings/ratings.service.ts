import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Rating, RaterRole } from '../../database/entities/rating.entity';
import { Booking, BookingStatus } from '../../database/entities/booking.entity';
import { User } from '../../database/entities/user.entity';
import { SubmitRatingDto } from './dto/submit-rating.dto';

// Ratings are revealed after 7 days if the other party hasn't submitted
const REVEAL_AFTER_DAYS = 7;

// Trust flag threshold: if average drops below this, flag for review
const LOW_RATING_THRESHOLD = 2.5;
const MIN_RATINGS_FOR_FLAG = 5;

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async submit(rater: User, dto: SubmitRatingDto): Promise<{ message: string }> {
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.bookingId },
      relations: { trip: true },
    });

    if (!booking) throw new NotFoundException('Booking not found');

    if (
      booking.status !== BookingStatus.TRIP_COMPLETED &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new BadRequestException('Can only rate after a completed trip');
    }

    const isDriver = booking.trip.driverId === rater.id;
    const isPassenger = booking.passengerId === rater.id;

    if (!isDriver && !isPassenger) throw new ForbiddenException('Not your booking');

    const rateeId = isDriver ? booking.passengerId : booking.trip.driverId;
    const raterRole = isDriver ? RaterRole.DRIVER : RaterRole.PASSENGER;

    const existing = await this.ratingRepo.findOne({
      where: { bookingId: dto.bookingId, raterId: rater.id },
    });
    if (existing) throw new BadRequestException('You have already rated this trip');

    const revealAfter = new Date();
    revealAfter.setDate(revealAfter.getDate() + REVEAL_AFTER_DAYS);

    await this.dataSource.transaction(async (manager) => {
      const rating = manager.create(Rating, {
        tripId: booking.tripId,
        bookingId: dto.bookingId,
        raterId: rater.id,
        rateeId,
        raterRole,
        score: dto.score,
        comment: dto.comment,
        isRevealed: true,
        revealAfter,
      });
      await manager.save(Rating, rating);

      // Recalculate ratee's average immediately
      await this.recalculateRating(manager, rateeId);

      // If the other party already rated us, reveal their rating too and update our average
      const otherRating = await manager.findOne(Rating, {
        where: { bookingId: dto.bookingId, raterId: rateeId },
      });
      if (otherRating && !otherRating.isRevealed) {
        await manager.update(Rating, { id: otherRating.id }, { isRevealed: true });
        await this.recalculateRating(manager, rater.id);
      }
    });

    return { message: 'شكراً! تم إرسال التقييم بنجاح.' };
  }

  private async recalculateRating(manager: any, userId: string): Promise<void> {
    const result = await manager
      .createQueryBuilder(Rating, 'r')
      .select('AVG(r.score)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.ratee_id = :userId AND r.is_revealed = true', { userId })
      .getRawOne();

    const average = parseFloat(result.avg ?? '0');
    const count = parseInt(result.count ?? '0', 10);

    await manager.update(User, userId, {
      ratingAverage: parseFloat(average.toFixed(2)),
      ratingCount: count,
    });

    // Trust & safety: flag if average is too low
    if (count >= MIN_RATINGS_FOR_FLAG && average < LOW_RATING_THRESHOLD) {
      await manager.update(User, userId, { trustFlagged: true });
    }
  }

  async getRevealedRatingsForUser(userId: string): Promise<Rating[]> {
    return this.ratingRepo.find({
      where: { rateeId: userId, isRevealed: true },
      relations: { rater: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // Reveal ratings whose 7-day window has expired and recalculate affected users
  @Cron(CronExpression.EVERY_HOUR)
  async revealExpiredRatings(): Promise<void> {
    const expired = await this.ratingRepo.find({
      where: { isRevealed: false, revealAfter: LessThanOrEqual(new Date()) },
    });
    if (expired.length === 0) return;

    await this.dataSource.transaction(async (manager) => {
      const ids = expired.map((r) => r.id);
      await manager.update(Rating, ids, { isRevealed: true });

      const affectedUsers = [...new Set(expired.map((r) => r.rateeId))];
      for (const userId of affectedUsers) {
        await this.recalculateRating(manager, userId);
      }
    });
  }
}
