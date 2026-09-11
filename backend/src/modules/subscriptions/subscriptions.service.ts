import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';

const FREE_TRIAL_DAYS = 30;

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe;

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY')!);
  }

  isInFreeTrial(user: User): boolean {
    const trialEnd = new Date(user.createdAt);
    trialEnd.setDate(trialEnd.getDate() + FREE_TRIAL_DAYS);
    return new Date() < trialEnd;
  }

  async getStatus(userId: string): Promise<{
    canPost: boolean;
    isFreeTrial: boolean;
    trialDaysLeft: number;
    subscription: Subscription | null;
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const isFreeTrial = this.isInFreeTrial(user);
    const trialEnd = new Date(user.createdAt);
    trialEnd.setDate(trialEnd.getDate() + FREE_TRIAL_DAYS);
    const trialDaysLeft = Math.max(
      0,
      Math.ceil((trialEnd.getTime() - Date.now()) / 86400000),
    );

    const subscription = await this.subRepo.findOne({ where: { userId } });
    const hasActiveSub =
      subscription?.status === SubscriptionStatus.ACTIVE &&
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd > new Date();

    return {
      canPost: isFreeTrial || hasActiveSub === true,
      isFreeTrial,
      trialDaysLeft,
      subscription: subscription ?? null,
    };
  }

  async createCheckoutSession(
    user: User,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ url: string }> {
    const priceId = this.config.get<string>('STRIPE_PRO_PRICE_ID') ?? '';

    let sub = await this.subRepo.findOne({ where: { userId: user.id } });
    let customerId: string;

    if (sub?.stripeCustomerId) {
      customerId = sub.stripeCustomerId;
    } else {
      const customer = await this.stripe.customers.create({
        email: `${user.phoneNumber}@yalansafr.app`,
        name: user.fullName,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId: user.id },
    });

    if (!sub) {
      sub = this.subRepo.create({
        userId: user.id,
        stripeCustomerId: customerId,
        status: SubscriptionStatus.CANCELLED,
      });
      await this.subRepo.save(sub);
    } else if (!sub.stripeCustomerId) {
      sub.stripeCustomerId = customerId;
      await this.subRepo.save(sub);
    }

    return { url: session.url ?? '' };
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const customerId = stripeSub.customer as string;
        const sub = await this.subRepo.findOne({ where: { stripeCustomerId: customerId } });
        if (sub) {
          sub.stripeSubscriptionId = stripeSub.id;
          sub.status = stripeSub.status as SubscriptionStatus;
          const periodEnd = (stripeSub as any).current_period_end ?? stripeSub.items?.data?.[0]?.current_period_end;
          sub.currentPeriodEnd = periodEnd ? new Date(periodEnd * 1000) : null;
          await this.subRepo.save(sub);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const customerId = stripeSub.customer as string;
        const sub = await this.subRepo.findOne({ where: { stripeCustomerId: customerId } });
        if (sub) {
          sub.status = SubscriptionStatus.CANCELLED;
          sub.stripeSubscriptionId = null;
          await this.subRepo.save(sub);
        }
        break;
      }
    }
  }

  async canUserPostTrip(userId: string): Promise<boolean> {
    const { canPost } = await this.getStatus(userId);
    return canPost;
  }
}
