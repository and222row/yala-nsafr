import { Controller, Get, Post, Body, Headers, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SubscriptionsService } from './subscriptions.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { User } from '../../database/entities/user.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.subscriptionsService.getStatus(user.id);
  }

  @Post('checkout')
  createCheckout(
    @CurrentUser() user: User,
    @Body() body: { successUrl: string; cancelUrl: string },
  ) {
    return this.subscriptionsService.createCheckoutSession(
      user,
      body.successUrl,
      body.cancelUrl,
    );
  }

  @Public()
  @Post('webhook')
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    await this.subscriptionsService.handleWebhook(req.rawBody!, sig);
    return { received: true };
  }
}
