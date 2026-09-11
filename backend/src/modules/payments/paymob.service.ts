import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Booking } from '../../database/entities/booking.entity';
import { User } from '../../database/entities/user.entity';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

@Injectable()
export class PaymobService {
  private readonly logger = new Logger(PaymobService.name);

  constructor(private readonly config: ConfigService) {}

  private async post<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${PAYMOB_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Paymob ${path} failed [${res.status}]: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async getAuthToken(): Promise<string> {
    const data = await this.post<{ token: string }>('/auth/tokens', {
      api_key: this.config.get('PAYMOB_API_KEY'),
    });
    return data.token;
  }

  private async createOrder(
    token: string,
    amountCents: number,
    merchantOrderId: string,
  ): Promise<number> {
    const data = await this.post<{ id: number }>('/ecommerce/orders', {
      auth_token: token,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: merchantOrderId,
      items: [],
    });
    return data.id;
  }

  private async getPaymentKey(
    token: string,
    orderId: number,
    amountCents: number,
    billing: object,
    integrationId: number,
  ): Promise<string> {
    const data = await this.post<{ token: string }>('/acceptance/payment_keys', {
      auth_token: token,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: orderId,
      billing_data: billing,
      currency: 'EGP',
      integration_id: integrationId,
      lock_order_when_paid: false,
    });
    return data.token;
  }

  async initiatePayment(
    booking: Booking,
    passenger: User,
  ): Promise<{ paymentUrl: string; paymobOrderId: string }> {
    const amountCents = Math.round(Number(booking.totalAmount) * 100);

    const token = await this.getAuthToken();
    const paymobOrderId = await this.createOrder(token, amountCents, booking.id);

    const nameParts = (passenger.fullName ?? 'N A').trim().split(' ');
    const firstName = nameParts[0] ?? 'N';
    const lastName = nameParts.slice(1).join(' ') || 'A';

    const billing = {
      apartment: 'N/A', email: 'N/A', floor: 'N/A',
      first_name: firstName, last_name: lastName,
      street: 'N/A', building: 'N/A',
      phone_number: passenger.phoneNumber,
      shipping_method: 'N/A', postal_code: 'N/A',
      city: 'Cairo', country: 'EG', state: 'N/A',
    };

    const integrationId = parseInt(
      this.config.get<string>('PAYMOB_INTEGRATION_ID_CARD') ?? '0',
      10,
    );
    const paymentKey = await this.getPaymentKey(
      token, paymobOrderId, amountCents, billing, integrationId,
    );

    const iframeId = this.config.get<string>('PAYMOB_IFRAME_ID');
    const paymentUrl = `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentKey}`;

    this.logger.log(`Paymob order created: ${paymobOrderId} for booking ${booking.id}`);
    return { paymentUrl, paymobOrderId: paymobOrderId.toString() };
  }

  // Verifies the HMAC sent by Paymob in the webhook query string.
  // Fields concatenated per Paymob docs: https://docs.paymob.com/docs/transaction-webhook
  verifyWebhookHmac(obj: Record<string, any>, receivedHmac: string): boolean {
    const secret = this.config.get<string>('PAYMOB_HMAC_SECRET') ?? '';
    if (!secret || !receivedHmac) return false;

    const concatenated = [
      obj.amount_cents,
      obj.created_at,
      obj.currency,
      obj.error_occured,
      obj.has_parent_transaction,
      obj.id,
      obj.integration_id,
      obj.is_3d_secure,
      obj.is_auth,
      obj.is_capture,
      obj.is_refunded,
      obj.is_standalone_payment,
      obj.is_voided,
      obj.order?.id,
      obj.owner,
      obj.pending,
      obj.source_data?.pan,
      obj.source_data?.sub_type,
      obj.source_data?.type,
      obj.success,
    ].join('');

    const computed = crypto
      .createHmac('sha512', secret)
      .update(concatenated)
      .digest('hex');

    if (computed.length !== receivedHmac.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(receivedHmac, 'hex'),
    );
  }
}
