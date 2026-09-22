import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Dispute,
  DisputeStatus,
  MAX_DISPUTE_EVIDENCE,
} from '../../database/entities/dispute.entity';
import { Booking } from '../../database/entities/booking.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RespondToDisputeDto } from './dto/respond-to-dispute.dto';
import { AddEvidenceDto } from './dto/add-evidence.dto';

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async loadWithAccess(disputeId: string, user: User) {
    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
      relations: { openedBy: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const booking = await this.bookingRepo.findOne({
      where: { id: dispute.bookingId },
      relations: { trip: { driver: true }, passenger: true, payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const isOpener = dispute.openedByUserId === user.id;
    const isDriver = booking.trip.driverId === user.id;
    const isPassenger = booking.passengerId === user.id;

    if (!isDriver && !isPassenger) {
      throw new ForbiddenException('You are not a party to this dispute');
    }

    const isOtherParty = !isOpener && (isDriver || isPassenger);
    const otherPartyId = isDriver ? booking.passengerId : booking.trip.driverId;

    return { dispute, booking, isOpener, isOtherParty, otherPartyId };
  }

  // ── User-facing actions ────────────────────────────────────────────────────

  async getMyDisputes(user: User) {
    // Find all bookings where user is driver or passenger
    const bookings = await this.bookingRepo
      .createQueryBuilder('b')
      .leftJoin('b.trip', 't')
      .where('b.passenger_id = :uid OR t.driver_id = :uid', { uid: user.id })
      .andWhere('b.dispute_id IS NOT NULL')
      .select('b.dispute_id', 'disputeId')
      .getRawMany<{ disputeId: string }>();

    if (!bookings.length) return [];

    const disputeIds = bookings.map((b) => b.disputeId).filter(Boolean);
    if (!disputeIds.length) return [];

    return this.disputeRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.openedBy', 'openedBy')
      .whereInIds(disputeIds)
      .orderBy('d.created_at', 'DESC')
      .getMany();
  }

  async getDisputeDetail(disputeId: string, user: User) {
    const { dispute, booking } = await this.loadWithAccess(disputeId, user);

    return {
      dispute,
      booking: {
        id: booking.id,
        totalAmount: booking.totalAmount,
        paymentMethod: booking.paymentMethod,
        status: booking.status,
        trip: {
          id: booking.trip.id,
          originCity: booking.trip.originCity,
          destinationCity: booking.trip.destinationCity,
          departureTime: booking.trip.departureTime,
          driver: {
            id: booking.trip.driver.id,
            fullName: booking.trip.driver.fullName,
            profilePhotoUrl: booking.trip.driver.profilePhotoUrl,
            ratingAverage: booking.trip.driver.ratingAverage,
          },
        },
        passenger: {
          id: booking.passenger.id,
          fullName: booking.passenger.fullName,
          profilePhotoUrl: booking.passenger.profilePhotoUrl,
          ratingAverage: booking.passenger.ratingAverage,
        },
      },
    };
  }

  /**
   * Appends to an evidence list, rejecting the whole request if it would exceed the cap.
   * This used to `.slice(0, 10)` the result, so the eleventh photo vanished without
   * telling anyone — the submitter thought the admin had it.
   */
  private appendEvidence(existing: string[] | null, incoming: string[]): string[] {
    const merged = [...(existing ?? []), ...incoming];
    if (merged.length > MAX_DISPUTE_EVIDENCE) {
      throw new BadRequestException(
        `You can attach at most ${MAX_DISPUTE_EVIDENCE} pieces of evidence to a dispute ` +
          `(you already have ${(existing ?? []).length})`,
      );
    }
    return merged;
  }

  async addEvidence(disputeId: string, user: User, dto: AddEvidenceDto): Promise<Dispute> {
    const { dispute, isOpener } = await this.loadWithAccess(disputeId, user);

    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Cannot add evidence to a closed dispute');
    }

    // Either party may add evidence, and may keep adding it while the dispute is open.
    // Previously only the opener could, which meant the responding party had exactly one
    // chance to attach anything — a photo found later could not be submitted at all.
    if (isOpener) {
      dispute.evidenceUrls = this.appendEvidence(dispute.evidenceUrls, dto.evidenceUrls);
    } else {
      dispute.otherPartyEvidenceUrls = this.appendEvidence(
        dispute.otherPartyEvidenceUrls,
        dto.evidenceUrls,
      );
    }

    return this.disputeRepo.save(dispute);
  }

  async respond(disputeId: string, user: User, dto: RespondToDisputeDto): Promise<Dispute> {
    const { dispute, isOtherParty } = await this.loadWithAccess(disputeId, user);

    if (!isOtherParty) {
      throw new ForbiddenException(
        'Only the other party can use this endpoint. The opener should use add-evidence instead.',
      );
    }

    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Dispute is no longer open for responses');
    }

    // A follow-up is appended rather than rejected. Someone who remembers a detail after
    // sending their first reply had no way to add it, and overwriting would have destroyed
    // the statement the admin may already have read.
    const isFollowUp = !!dispute.otherPartyResponse;
    dispute.otherPartyResponse = isFollowUp
      ? `${dispute.otherPartyResponse}\n\n— إضافة (${new Date().toISOString()}):\n${dto.response}`
      : dto.response;

    if (dto.evidenceUrls?.length) {
      dispute.otherPartyEvidenceUrls = this.appendEvidence(
        dispute.otherPartyEvidenceUrls,
        dto.evidenceUrls,
      );
    }

    const saved = await this.disputeRepo.save(dispute);

    // Notify the opener that the other party has responded
    setImmediate(() => {
      void this.notifications.sendToUser(dispute.openedByUserId, {
        title: isFollowUp ? 'رد إضافي على نزاعك' : 'وصل رد على نزاعك',
        body: isFollowUp
          ? 'أضاف الطرف الآخر تفاصيل جديدة إلى رده. سيراجع فريقنا كل ما تم تقديمه.'
          : 'قدّم الطرف الآخر رده. سيراجع فريقنا وجهتي النظر قريباً.',
        data: { disputeId: saved.id, screen: 'dispute_detail' },
      });
    });

    return saved;
  }

  async getSlaStatus(disputeId: string, user: User) {
    const { dispute } = await this.loadWithAccess(disputeId, user);

    const now = new Date();
    const hoursUntilSla = dispute.slaDeadline
      ? Math.max(0, (dispute.slaDeadline.getTime() - now.getTime()) / 3_600_000)
      : null;

    const responseWindowOpen =
      dispute.status === DisputeStatus.OPEN || dispute.status === DisputeStatus.UNDER_REVIEW;

    return {
      id: dispute.id,
      status: dispute.status,
      slaDeadline: dispute.slaDeadline,
      hoursUntilSlaExpiry: hoursUntilSla ? parseFloat(hoursUntilSla.toFixed(1)) : null,
      hasOpenerEvidence: (dispute.evidenceUrls ?? []).length > 0,
      hasOtherPartyResponse: !!dispute.otherPartyResponse,
      hasOtherPartyEvidence: (dispute.otherPartyEvidenceUrls ?? []).length > 0,
      responseWindowOpen,
      resolvedAt: dispute.resolvedAt ?? null,
    };
  }
}
