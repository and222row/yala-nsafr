import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { SearchTripsDto } from './dto/search-trips.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CancelReasonDto } from '../../common/dto/cancel-reason.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';
import { TripStatus } from '../../database/entities/trip.entity';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get('search')
  @UseGuards(JwtAuthGuard)
  search(@Query() dto: SearchTripsDto, @CurrentUser() user: User) {
    return this.tripsService.search(dto, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tripsService.findByIdPublic(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: User, @Body() dto: CreateTripDto) {
    return this.tripsService.create(user, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateTripDto,
  ) {
    return this.tripsService.updateTrip(id, user, dto as any);
  }

  @Patch(':id/start')
  @UseGuards(JwtAuthGuard)
  startTrip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tripsService.startTrip(id, user);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: CancelReasonDto,
  ) {
    return this.tripsService.cancel(id, user, dto.reason);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard)
  markComplete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tripsService.markComplete(id, user);
  }

  @Get('driver/my-trips')
  @UseGuards(JwtAuthGuard)
  myTrips(@CurrentUser() user: User, @Query('status') status?: TripStatus) {
    return this.tripsService.getDriverTrips(user.id, status);
  }

  @Get(':id/bookings')
  @UseGuards(JwtAuthGuard)
  getTripBookings(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tripsService.getBookingsForTrip(id, user);
  }

  @Get(':id/comments')
  getComments(@Param('id', ParseUUIDPipe) id: string) {
    return this.tripsService.getComments(id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: CreateCommentDto,
  ) {
    return this.tripsService.addComment(id, user, dto.body);
  }

  @Get(':id/co-passengers')
  @UseGuards(JwtAuthGuard)
  getCoPassengers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.tripsService.getCoPassengers(id, user);
  }

}
