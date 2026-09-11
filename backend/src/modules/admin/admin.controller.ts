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
import { AdminService } from './admin.service';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { NotifyPartyDto } from './dto/notify-party.dto';
import { UpdateConfigDto } from './dto/update-config.dto';
import { ListUsersQueryDto, ListDisputesQueryDto, ListTripsQueryDto } from './dto/list-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Config ─────────────────────────────────────────────────────────────────
  @Get('config')
  getConfig() {
    return this.adminService.getConfig();
  }

  @Patch('config')
  updateConfig(@Body() dto: UpdateConfigDto) {
    return this.adminService.updateConfig(dto);
  }

  // ── Analytics ──────────────────────────────────────────────────────────────
  @Get('analytics')
  getAnalytics() {
    return this.adminService.getAnalytics();
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  @Get('search')
  search(@Query('q') q: string) {
    return this.adminService.search(q ?? '');
  }

  // ── Users ──────────────────────────────────────────────────────────────────
  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(id, dto);
  }

  @Post('users/:id/verify-id/approve')
  approveId(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
  ) {
    return this.adminService.approveIdVerification(id, admin.id);
  }

  @Post('users/:id/verify-id/reject')
  rejectId(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.rejectIdVerification(id);
  }

  @Post('users/:id/verify-driver/approve')
  approveDriver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
  ) {
    return this.adminService.approveDriverVerification(id, admin.id);
  }

  @Post('users/:id/verify-driver/reject')
  rejectDriver(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.rejectDriverVerification(id);
  }

  // ── Trips ──────────────────────────────────────────────────────────────────
  @Get('trips')
  listTrips(@Query() query: ListTripsQueryDto) {
    return this.adminService.listTrips(query);
  }

  @Get('trips/:id')
  getTripDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getTripDetail(id);
  }

  // ── Disputes ───────────────────────────────────────────────────────────────
  @Get('disputes')
  listDisputes(@Query() query: ListDisputesQueryDto) {
    return this.adminService.listDisputes(query);
  }

  @Get('disputes/:id')
  getDisputeDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getDisputeDetail(id);
  }

  @Post('disputes/:id/assign')
  assignDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
  ) {
    return this.adminService.assignDispute(id, admin.id);
  }

  @Post('disputes/:id/resolve')
  resolveDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.adminService.resolveDispute(id, admin.id, dto);
  }

  @Post('disputes/:id/notify')
  notifyParty(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: User,
    @Body() dto: NotifyPartyDto,
  ) {
    return this.adminService.notifyParty(id, admin.id, dto);
  }
}
