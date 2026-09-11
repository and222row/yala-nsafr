import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SubmitIdVerificationDto } from './dto/submit-id-verification.dto';
import { SubmitDriverVerificationDto } from './dto/submit-driver-verification.dto';

const REFERRAL_WELCOME_CREDIT = 20;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getPublicProfile(id: string) {
    const user = await this.findById(id);
    return {
      id: user.id,
      fullName: user.fullName,
      profilePhotoUrl: user.profilePhotoUrl,
      ratingAverage: user.ratingAverage,
      ratingCount: user.ratingCount,
      completedTripsAsDriver: user.completedTripsAsDriver,
      cancelledTripsAsDriver: user.cancelledTripsAsDriver,
      completedTripsAsPassenger: user.completedTripsAsPassenger,
      idVerified: user.idVerified,
      driverVerified: user.driverVerified,
      vehicleMake: user.vehicleMake,
      vehicleModel: user.vehicleModel,
      vehicleYear: user.vehicleYear,
      vehicleColor: user.vehicleColor,
      allowsSmoking: user.allowsSmoking,
      allowsPets: user.allowsPets,
      gender: user.gender,
      memberSince: user.createdAt,
    };
  }

  async updateProfile(user: User, dto: UpdateProfileDto): Promise<User> {
    Object.assign(user, dto);
    if (user.status === UserStatus.PENDING_VERIFICATION && dto.fullName) {
      user.status = UserStatus.ACTIVE;
    }
    return this.userRepo.save(user);
  }

  async applyReferralCode(user: User, code: string): Promise<{ message: string; promoBalance: number }> {
    if (user.referredByUserId) {
      throw new BadRequestException('كود الدعوة تم تطبيقه بالفعل');
    }
    if (user.completedTripsAsPassenger > 0) {
      throw new BadRequestException('كود الدعوة يجب تطبيقه قبل أول رحلة');
    }

    const normalizedCode = code.trim().toUpperCase();
    const referrer = await this.userRepo.findOne({ where: { referralCode: normalizedCode } });
    if (!referrer) throw new NotFoundException('كود الدعوة غير صحيح');
    if (referrer.id === user.id) throw new BadRequestException('لا يمكنك استخدام كودك الخاص');

    user.referredByUserId = referrer.id;
    const current = parseFloat(user.promoBalance?.toString() ?? '0');
    user.promoBalance = +(current + REFERRAL_WELCOME_CREDIT).toFixed(2);
    await this.userRepo.save(user);

    return {
      message: `تم تطبيق كود الدعوة! حصلت على ${REFERRAL_WELCOME_CREDIT} جنيه رصيد ترحيبي`,
      promoBalance: user.promoBalance,
    };
  }

  async submitIdVerification(user: User, dto: SubmitIdVerificationDto): Promise<{ message: string }> {
    user.nationalIdNumber = dto.nationalIdNumber;
    if (dto.nationalIdPhotoUrl) user.nationalIdPhotoUrl = dto.nationalIdPhotoUrl;
    await this.userRepo.save(user);
    return { message: 'ID verification submitted. An admin will review it shortly.' };
  }

  async submitDriverVerification(user: User, dto: SubmitDriverVerificationDto): Promise<{ message: string }> {
    Object.assign(user, dto);
    if (user.role !== UserRole.ADMIN) {
      user.role = UserRole.BOTH;
    }
    await this.userRepo.save(user);
    return { message: 'Driver verification submitted. An admin will review it shortly.' };
  }

  async updateFcmToken(userId: string, token: string): Promise<void> {
    await this.userRepo.update(userId, { fcmToken: token });
  }
}
