import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';
import { OpenDisputeDto } from '../admin/dto/open-dispute.dto';
import { CancelReasonDto } from '../../common/dto/cancel-reason.dto';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user, dto);
  }

  @Get('my')
  myBookings(@CurrentUser() user: User) {
    return this.bookingsService.getPassengerBookings(user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.findById(id);
  }

  // Called by the in-app WebView after intercepting Kashier's payment redirect
  @Post(':id/heal')
  @HttpCode(HttpStatus.OK)
  healPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('kashierOrderId') kashierOrderId: string,
  ) {
    return this.bookingsService.healFromRedirect(id, kashierOrderId);
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.bookingsService.approveBooking(id, user);
  }

  @Patch(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.bookingsService.rejectBooking(id, user);
  }

  @Patch(':id/confirm-completion')
  confirmCompletion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.bookingsService.confirmCompletion(id, user);
  }

  @Get(':id/cancel-preview')
  cancelPreview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.bookingsService.getCancelPreview(id, user);
  }

  @Patch(':id/cancel')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: CancelReasonDto,
  ) {
    return this.bookingsService.cancelByPassenger(id, user, dto.reason);
  }

  @Post('disputes')
  openDispute(@CurrentUser() user: User, @Body() dto: OpenDisputeDto) {
    return this.bookingsService.openDispute(user, dto);
  }

  @Post(':id/mock-confirm')
  @HttpCode(HttpStatus.OK)
  mockConfirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.mockConfirmPayment(id);
  }
}
