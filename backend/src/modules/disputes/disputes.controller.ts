import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { RespondToDisputeDto } from './dto/respond-to-dispute.dto';
import { AddEvidenceDto } from './dto/add-evidence.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('disputes')
@UseGuards(JwtAuthGuard)
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  /**
   * List all disputes the current user is a party to
   * (whether they opened it or are the other side)
   */
  @Get('my')
  getMyDisputes(@CurrentUser() user: User) {
    return this.disputesService.getMyDisputes(user);
  }

  /**
   * Full detail of a specific dispute — only accessible to the two parties
   */
  @Get(':id')
  getDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.disputesService.getDisputeDetail(id, user);
  }

  /**
   * SLA clock + completion status (how long until admin must resolve, who has responded)
   */
  @Get(':id/status')
  getSlaStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.disputesService.getSlaStatus(id, user);
  }

  /**
   * The person who OPENED the dispute adds more evidence (photos, messages)
   */
  @Patch(':id/evidence')
  addEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: AddEvidenceDto,
  ) {
    return this.disputesService.addEvidence(id, user, dto);
  }

  /**
   * The OTHER PARTY submits their account of what happened + their evidence
   */
  @Post(':id/respond')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: RespondToDisputeDto,
  ) {
    return this.disputesService.respond(id, user, dto);
  }
}
