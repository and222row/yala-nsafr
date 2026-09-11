import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('trips/:tripId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  getMessages(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @CurrentUser() user: User,
    @Query('after') after?: string,
  ) {
    return this.messagesService.getMessages(tripId, user.id, after);
  }

  @Post()
  sendMessage(
    @Param('tripId', ParseUUIDPipe) tripId: string,
    @CurrentUser() user: User,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagesService.sendMessage(tripId, user, dto.body);
  }
}
