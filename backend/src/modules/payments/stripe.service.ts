import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import {
  Booking,
  BookingStatus,
} from '../../database/entities/booking.entity';
import {
  Payment,
  PaymentStatus,
} from '../../database/entities/payment.entity';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe;
  private readonly publishableKey: string;
  private readonly webhookSecret: string;

  constructor(
    private config: ConfigService,
    @InjectRepository(Booking) private bookingRepo: Repository<Booking>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
  ) {
    this.stripe = new Stripe(config.get<string>('STRIPE_SECRET_KEY')!);
    this.publishableKey = config.get<string>('STRIPE_PUBLISHABLE_KEY')!;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET')!;
  }

  async createPaymentIntent(bookingId: string, userId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, passengerId: userId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.PENDING_DRIVER_APPROVAL) {
      throw new BadRequestException('Booking is not awaiting payment');
    }

    const amountPiastres = Math.round(Number(booking.totalAmount) * 100);

    const intent = await this.stripe.paymentIntents.create({
      amount: amountPiastres,
      currency: 'egp',
      metadata: { bookingId, userId },
    });

    // Upsert Payment record
    const existing = await this.paymentRepo.findOne({ where: { bookingId } });
    if (existing) {
      await this.paymentRepo.update(existing.id, {
        gatewayTransactionId: intent.id,
        gatewayName: 'stripe',
      });
    } else {
      await this.paymentRepo.save(
        this.paymentRepo.create({
          bookingId,
          amount: booking.totalAmount,
          currency: 'EGP',
          gatewayName: 'stripe',
          gatewayTransactionId: intent.id,
          status: PaymentStatus.PENDING,
        }),
      );
    }

    return {
      clientSecret: intent.client_secret,
      publishableKey: this.publishableKey,
    };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const payment = await this.paymentRepo.findOne({
        where: { gatewayTransactionId: intent.id },
      });
      if (payment) {
        await this.paymentRepo.update(payment.id, {
          status: PaymentStatus.CAPTURED,
          capturedAt: new Date(),
          gatewayResponse: intent as unknown as object,
        });
        await this.bookingRepo.update(payment.bookingId, {
          status: BookingStatus.CONFIRMED,
          confirmedAt: new Date(),
        });
      }
    }

    return { received: true };
  }
}
