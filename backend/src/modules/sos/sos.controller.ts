import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SosService } from './sos.service';
import { CreateSosDto } from './dto/create-sos.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('trips')
export class SosController {
  constructor(private readonly sos: SosService) {}

  @Post(':tripId/sos')
  @UseGuards(JwtAuthGuard)
  trigger(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @Body() dto: CreateSosDto,
    @CurrentUser() user: User,
  ) {
    return this.sos.trigger(user.id, tripId, dto);
  }

  @Patch('sos/:alertId/resolve')
  @UseGuards(JwtAuthGuard)
  resolve(@Param('alertId', ParseUUIDPipe) alertId: string) {
    return this.sos.resolve(alertId);
  }

  @Get('sos/pending')
  @UseGuards(JwtAuthGuard)
  listPending() {
    return this.sos.listPending();
  }
}
