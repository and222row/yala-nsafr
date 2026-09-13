import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as querystring from 'node:querystring';
import { Booking } from '../../database/entities/booking.entity';

const KASHIER_LIVE_API = 'https://api.kashier.io';
const KASHIER_TEST_API = 'https://test-api.kashier.io';

// Order operations (CAPTURE / VOID / REFUND) are served by the front-end processor
// host, not the main API host. Sending them to api.kashier.io returns an Express
// "Cannot PUT /v3/orders/..." 404 because the route only exists on fep.
const KASHIER_LIVE_FEP = 'https://fep.kashier.io';
const KASHIER_TEST_FEP = 'https://test-fep.kashier.io';

export interface KashierTransferParams {
  amount: number;
  method: string;        // 'wallet' | 'instant wallet' | 'bank'
  recipientName: string;
  recipientNumber: string;
  merchantTransferId: string;
  recipientBank?: string;
}

@Injectable()
export class KashierService {
  private readonly logger = new Logger(KashierService.name);

  constructor(private readonly config: ConfigService) {}

  private get secretKey() { return this.config.get<string>('KASHIER_SECRET_KEY') ?? ''; }
  private get apiKey() { return this.config.get<string>('KASHIER_API_KEY') ?? ''; }
  // Separate credential from the Payment API Key — only used to verify payout webhooks
  private get transferApiKey() { return this.config.get<string>('KASHIER_TRANSFER_API_KEY') ?? ''; }
  private get merchantId() { return this.config.get<string>('KASHIER_MERCHANT_ID') ?? ''; }
  private get isProd() { return this.config.get<string>('NODE_ENV') === 'production'; }
  private get baseUrl() { return this.isProd ? KASHIER_LIVE_API : KASHIER_TEST_API; }
  private get fepUrl() { return this.isProd ? KASHIER_LIVE_FEP : KASHIER_TEST_FEP; }
  get isMock() { return this.config.get<string>('PAYMENT_MOCK') === 'true'; }
  private get appUrl() { return this.config.get<string>('APP_URL') ?? 'https://yalansafr.app'; }

  private headers() {
    return {
      Authorization: this.secretKey,
      'api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(path: string, body: unknown, base = this.baseUrl): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kashier API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kashier API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // Payment status is read from the session endpoint on the API host. There is no
  // GET /v3/orders route — that path only exists on fep, and only for PUT.
  // Returns null when the status cannot be determined, so callers must treat null as
  // "unknown" rather than "not paid".
  async getPaymentStatus(sessionId?: string | null): Promise<string | null> {
    if (this.isMock || !sessionId) return null;
    try {
      const res = await this.get<{ data?: { status?: string; orderStatus?: string } }>(
        `/v3/payment/sessions/${sessionId}/payment`,
      );
      this.logger.log(`Kashier getPaymentStatus(${sessionId}): ${JSON.stringify(res)}`);
      const status = res.data?.status ?? res.data?.orderStatus ?? null;
      return status ? status.toUpperCase() : null;
    } catch (e) {
      this.logger.error(`getPaymentStatus error for session ${sessionId}: ${String(e)}`);
      return null;
    }
  }

  // Only order operations use PUT, and those live on the fep host.
  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.fepUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kashier API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Payment Sessions ────────────────────────────────────────────────────────

  async createPaymentSession(
    booking: Booking,
  ): Promise<{ sessionUrl: string; orderId: string; sessionId: string | null }> {
    const orderId = booking.id;

    if (this.isMock) {
      this.logger.warn(`PAYMENT_MOCK: returning mock session for booking ${orderId}`);
      return { sessionUrl: `mock://confirm/${orderId}`, orderId, sessionId: null };
    }

    const amount = Number(booking.totalAmount).toFixed(2);
    const data = await this.post<Record<string, unknown>>('/v3/payment/sessions', {
      amount,
      currency: 'EGP',
      merchantOrderId: orderId,
      merchantId: this.merchantId,
      // Requests authorize-only: the amount is held, not taken, and we capture on trip
      // completion. Also requires Kashier to enable "Authorization Capture" on the
      // account — without that the session charges outright. An authorized session
      // reports AUTHORIZED and fires an "authorize" webhook.
      manualCapture: true,
      display: 'ar',
      merchantRedirect: `${this.appUrl}/api/v1/kashier/payment-done`,
      customer: {
        name: booking.passenger?.fullName ?? 'Customer',
        email: `passenger-${booking.passengerId}@yalansafr.app`,
        phone: booking.passenger?.phoneNumber ?? '',
        reference: booking.passengerId,
      },
    });

    this.logger.log(`Kashier session response for ${orderId}: ${JSON.stringify(data)}`);
    // Handle both { sessionUrl: "..." } and { data: { sessionUrl: "..." } } response shapes
    const sessionUrl = (
      (data['sessionUrl'] as string | undefined) ??
      ((data['data'] as Record<string, unknown> | undefined)?.['sessionUrl'] as string | undefined) ??
      ''
    );
    if (!sessionUrl) {
      throw new Error(`Kashier returned no sessionUrl. Full response: ${JSON.stringify(data)}`);
    }

    // The session id is the last path segment of the checkout URL
    // (https://payments.kashier.io/session/<sessionId>?mode=test). It's needed later to
    // read payment status, since that endpoint is keyed by session, not order.
    const nested = data['data'] as Record<string, unknown> | undefined;
    const sessionId =
      (data['sessionId'] as string | undefined) ??
      (nested?.['sessionId'] as string | undefined) ??
      sessionUrl.split('?')[0].split('/').filter(Boolean).pop() ??
      null;

    return { sessionUrl, orderId, sessionId };
  }

  // ── Capture / Release ───────────────────────────────────────────────────────

  async capturePayment(orderId: string, amount: number): Promise<void> {
    if (this.isMock) {
      this.logger.warn(`PAYMENT_MOCK: mock capture for order ${orderId}`);
      return;
    }
    await this.put(`/v3/orders/${orderId}`, {
      apiOperation: 'CAPTURE',
      transaction: { amount },
    });
    this.logger.log(`Captured ${amount} EGP for order ${orderId}`);
  }

  // Releasing an authorization is a VOID — Kashier has no RELEASE operation.
  // targetTransactionId identifies the authorized transaction; when omitted Kashier
  // falls back to the order's pay transaction.
  async releasePayment(orderId: string, targetTransactionId?: string): Promise<void> {
    if (this.isMock) {
      this.logger.warn(`PAYMENT_MOCK: mock release for order ${orderId}`);
      return;
    }
    await this.put(`/v3/orders/${orderId}`, {
      apiOperation: 'VOID',
      ...(targetTransactionId ? { transaction: { targetTransactionId } } : {}),
    });
    this.logger.log(`Voided (released) order ${orderId}`);
  }

  async refundPayment(orderId: string, amount: number): Promise<void> {
    if (this.isMock) {
      this.logger.warn(`PAYMENT_MOCK: mock refund ${amount} for order ${orderId}`);
      return;
    }
    await this.put(`/v3/orders/${orderId}`, {
      apiOperation: 'REFUND',
      transaction: { amount },
    });
    this.logger.log(`Refunded ${amount} EGP for order ${orderId}`);
  }

  // ── Transfers (driver payouts) ───────────────────────────────────────────────

  async createTransfer(params: KashierTransferParams): Promise<{ transferId: string; isMock: boolean }> {
    if (this.isMock) {
      const transferId = `MOCK-TRS-${Date.now()}`;
      this.logger.warn(`PAYMENT_MOCK: mock transfer ${transferId}`);
      return { transferId, isMock: true };
    }

    const body: Record<string, unknown> = {
      amount: params.amount,
      method: params.method,
      recipientName: params.recipientName,
      recipientNumber: params.recipientNumber,
      merchantTransferId: params.merchantTransferId,
      saveBeneficiary: true,
    };
    if (params.recipientBank) body.recipientBank = params.recipientBank;

    // Documented as POST /v3/transfers/single on the checkout (fep) host.
    // The response's status is PENDING — the transfer has only been accepted here, so
    // callers must wait for the payout webhook or reconciliation before treating it
    // as delivered.
    const data = await this.post<{ data: Array<{ transferId: string }> }>(
      '/v3/transfers/single',
      body,
      this.fepUrl,
    );
    const transferId = data.data?.[0]?.transferId ?? '';
    this.logger.log(`Transfer accepted (PENDING): ${transferId} for ${params.merchantTransferId}`);
    return { transferId, isMock: false };
  }

  // Current state of a payout transfer, from the dashboard host. Kashier returns the
  // transfer object directly here (status at the top level) while the list endpoint
  // wraps its payload in `data`, so both are checked.
  // Returns null when the status can't be read — callers must treat that as "unknown",
  // not as failure.
  /**
   * Looks a transfer up by the id our own system assigned it. Needed when a create call
   * times out: Kashier may still have accepted the transfer, but we never received its
   * transferId, so it can only be found this way.
   * Returns null when Kashier has no such transfer (404) or cannot be reached.
   */
  async getTransferByMerchantId(
    merchantTransferId: string,
  ): Promise<{ transferId: string; status: string | null } | null> {
    if (this.isMock || !merchantTransferId) return null;
    try {
      const res = await this.get<Record<string, any>>(
        `/v2/transfers/merchant-transfer-id/${merchantTransferId}`,
      );
      const transferId = res?.['transferId'] ?? res?.['data']?.['transferId'] ?? null;
      if (!transferId) return null;
      const raw = res?.['status'] ?? res?.['data']?.['status'] ?? null;
      return {
        transferId: String(transferId),
        status: raw ? String(raw).toUpperCase() : null,
      };
    } catch (e) {
      // A 404 here means the create never reached Kashier, which is a valid answer
      this.logger.warn(`getTransferByMerchantId(${merchantTransferId}): ${String(e)}`);
      return null;
    }
  }

  async getTransferStatus(transferId?: string | null): Promise<string | null> {
    if (this.isMock || !transferId) return null;
    try {
      const res = await this.get<Record<string, any>>(`/v2/transfers/${transferId}`);
      const raw = res?.['status'] ?? res?.['data']?.['status'] ?? null;
      return raw ? String(raw).toUpperCase() : null;
    } catch (e) {
      this.logger.error(`getTransferStatus error for ${transferId}: ${String(e)}`);
      return null;
    }
  }

  async feesInquiry(amount: number, method: string): Promise<{ processingFee: string; totalAmountDue: string }> {
    if (this.isMock) {
      return { processingFee: '0.00', totalAmountDue: String(amount) };
    }
    const res = await this.post<{ data: { processingFee: string; totalAmountDue: string } }>('/v2/transfers/fee-inquiry', {
      transfers: [{ amount: String(amount), method }],
    });
    return res.data;
  }

  // ── Webhook verification ────────────────────────────────────────────────────

  // Kashier signs each webhook with HMAC-SHA256 over only the `data` fields named in
  // `data.signatureKeys`, sorted alphabetically, keyed with the Payment API Key — not
  // the secret key. Compared against the `x-kashier-signature` header.
  //
  // querystring.stringify (not URLSearchParams) is required: Kashier encodes a space as
  // %20, whereas URLSearchParams would emit + and every signature would mismatch.
  buildWebhookSignaturePayload(data: Record<string, unknown>): string | null {
    const keys = data['signatureKeys'];
    if (!Array.isArray(keys) || keys.length === 0) return null;

    const selected: Record<string, string> = {};
    for (const key of [...keys].map(String).sort()) {
      selected[key] = String(data[key] ?? '');
    }
    return querystring.stringify(selected);
  }

  // Payout webhooks sign differently from payment webhooks, and Kashier's docs warn
  // explicitly against sharing a verifier between them: keys are used in the order
  // signatureKeys lists them (NOT sorted), values are raw (NOT URL-encoded), and the
  // secret is the transfer API key (NOT the Payment API Key).
  buildTransferSignaturePayload(body: Record<string, unknown>): string | null {
    const keys = body['signatureKeys'];
    if (!Array.isArray(keys) || keys.length === 0) return null;
    return keys
      .map((k) => `${String(k)}=${String(body[String(k)] ?? '')}`)
      .join('&');
  }

  verifyTransferWebhookSignature(
    body: Record<string, unknown>,
    receivedSignature?: string,
  ): boolean {
    if (!receivedSignature || !this.transferApiKey) return false;

    const payload = this.buildTransferSignaturePayload(body);
    if (!payload) return false;

    const computed = crypto
      .createHmac('sha256', this.transferApiKey)
      .update(payload)
      .digest('hex');

    try {
      const a = Buffer.from(computed, 'hex');
      const b = Buffer.from(receivedSignature.trim().toLowerCase(), 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  verifyWebhookSignature(data: Record<string, unknown>, receivedSignature?: string): boolean {
    if (!receivedSignature || !this.apiKey) return false;

    const signaturePayload = this.buildWebhookSignaturePayload(data);
    if (!signaturePayload) return false;

    const computed = crypto
      .createHmac('sha256', this.apiKey)
      .update(signaturePayload)
      .digest('hex');

    try {
      const a = Buffer.from(computed, 'hex');
      const b = Buffer.from(receivedSignature.trim().toLowerCase(), 'hex');
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Maps our PayoutMethod enum value to the Kashier transfer method string
  toKashierMethod(payoutMethod: string): string {
    switch (payoutMethod) {
      case 'vodafone_cash': return 'wallet';
      case 'instapay': return 'instant wallet';
      case 'bank': return 'bank';
      default: return 'wallet';
    }
  }
}
