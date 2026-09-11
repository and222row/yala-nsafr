import { Controller, Post, Get, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@Controller('ratings')
@UseGuards(JwtAuthGuard)
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  submit(@CurrentUser() user: User, @Body() dto: SubmitRatingDto) {
    return this.ratingsService.submit(user, dto);
  }

  @Get('user/:id')
  userRatings(@Param('id', ParseUUIDPipe) id: string) {
    return this.ratingsService.getRevealedRatingsForUser(id);
  }
}
