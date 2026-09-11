import { Controller, Get, Patch, Post, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SubmitIdVerificationDto } from './dto/submit-id-verification.dto';
import { SubmitDriverVerificationDto } from './dto/submit-driver-verification.dto';
import { UpdateFcmTokenDto } from './dto/update-fcm-token.dto';
import { ApplyReferralDto } from './dto/apply-referral.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user, dto);
  }

  @Post('me/referral')
  @UseGuards(JwtAuthGuard)
  applyReferralCode(@CurrentUser() user: User, @Body() dto: ApplyReferralDto) {
    return this.usersService.applyReferralCode(user, dto.code);
  }

  @Post('me/id-verification')
  @UseGuards(JwtAuthGuard)
  submitIdVerification(@CurrentUser() user: User, @Body() dto: SubmitIdVerificationDto) {
    return this.usersService.submitIdVerification(user, dto);
  }

  @Post('me/driver-verification')
  @UseGuards(JwtAuthGuard)
  submitDriverVerification(@CurrentUser() user: User, @Body() dto: SubmitDriverVerificationDto) {
    return this.usersService.submitDriverVerification(user, dto);
  }

  @Patch('me/fcm-token')
  @UseGuards(JwtAuthGuard)
  updateFcmToken(@CurrentUser() user: User, @Body() dto: UpdateFcmTokenDto) {
    return this.usersService.updateFcmToken(user.id, dto.fcmToken);
  }

  @Get(':id/profile')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
