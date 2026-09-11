import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { User, UserStatus } from '../../database/entities/user.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { OtpService } from './otp.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly otpService: OtpService,
    private readonly jwtService: JwtService,
  ) {}

  async sendOtp(dto: SendOtpDto): Promise<{ message: string }> {
    await this.otpService.sendOtp(dto.phoneNumber);
    return { message: 'OTP sent' };
  }

  async verifyOtpAndLogin(
    dto: VerifyOtpDto,
  ): Promise<{ accessToken: string; refreshToken: string; isNewUser: boolean }> {
    await this.otpService.verifyOtp(dto.phoneNumber, dto.code);

    let user = await this.userRepo.findOne({ where: { phoneNumber: dto.phoneNumber } });
    const isNewUser = !user;

    if (!user) {
      const referralCode = await this.generateUniqueReferralCode();
      user = this.userRepo.create({
        phoneNumber: dto.phoneNumber,
        fullName: '',
        status: UserStatus.PENDING_VERIFICATION,
        referralCode,
      });
      user = await this.userRepo.save(user);
    }

    if (user.status === UserStatus.BANNED) {
      throw new UnauthorizedException('Account is banned');
    }

    const tokens = await this.generateTokens(user);
    return { ...tokens, isNewUser };
  }

  async refreshTokens(rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = this.hashToken(rawToken);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash: hash },
      relations: { user: true },
    });

    if (!stored || stored.expiresAt < new Date()) {
      if (stored) await this.refreshTokenRepo.delete(stored.id);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (stored.user.status === UserStatus.BANNED) {
      await this.refreshTokenRepo.delete(stored.id);
      throw new UnauthorizedException('Account is banned');
    }

    await this.refreshTokenRepo.delete(stored.id);
    return this.generateTokens(stored.user);
  }

  async signOut(rawToken: string): Promise<void> {
    const hash = this.hashToken(rawToken);
    await this.refreshTokenRepo.delete({ tokenHash: hash });
  }

  async validateUserById(userId: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { id: userId } });
  }

  private async generateTokens(user: User): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = this.jwtService.sign({ sub: user.id, phone: user.phoneNumber });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({ userId: user.id, tokenHash, expiresAt }),
    );

    return { accessToken, refreshToken: rawToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async generateUniqueReferralCode(): Promise<string> {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 6 }, () =>
        chars[Math.floor(Math.random() * chars.length)],
      ).join('');
      const exists = await this.userRepo.findOne({
        where: { referralCode: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    return Date.now().toString(36).toUpperCase().slice(-6);
  }
}
