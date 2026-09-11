import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';
import { StripeService } from './stripe.service';

@Controller('payments/stripe')
export class StripeController {
  constructor(private readonly stripeService: StripeService) {}

  @UseGuards(JwtAuthGuard)
  @Post('intent')
  createIntent(
    @Body('bookingId') bookingId: string,
    @CurrentUser() user: User,
  ) {
    return this.stripeService.createPaymentIntent(bookingId, user.id);
  }

  // Raw body required for Stripe webhook signature verification
  @Post('webhook')
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.stripeService.handleWebhook(req.rawBody!, sig);
  }
}
