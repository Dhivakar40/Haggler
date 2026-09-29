import { Injectable, Logger, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hmacHex, safeEqualHex } from '../../common/crypto';
import { EnvService } from '../../config/env.service';

export interface CreatedOrder {
  providerOrderId: string;
}

export interface PaymentsProvider {
  readonly mode: 'sandbox' | 'razorpay';
  /** The Checkout key id to hand the client (Razorpay Checkout needs it; sandbox has none). */
  readonly publicKeyId: string | null;
  createOrder(amountPaise: number, receipt: string): Promise<CreatedOrder>;
  /** The classic Razorpay Checkout success callback: verify order_id|payment_id was really signed. */
  verifyPaymentSignature(providerOrderId: string, paymentId: string, signature: string): boolean;
  /** Server-to-server webhook: verify the raw body was really signed with the webhook secret. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export const PAYMENTS_PROVIDER = Symbol('PAYMENTS_PROVIDER');

/**
 * Sandbox: no money moves and no gateway is called. It still does REAL HMAC signing and
 * verification (same algorithm Razorpay uses), signed with a fixed dev-only secret, so the whole
 * signature-checking code path is genuinely exercised in every environment (including CI) rather
 * than being stubbed to "always true". Orders are created instantly "paid-ready"; the mobile app's
 * sandbox checkout screen asks this provider to sign a payment id itself (see WalletService), the
 * same way the sandbox SMS provider prints a real, randomly generated OTP instead of a fixed one.
 */
@Injectable()
export class SandboxPaymentsProvider implements PaymentsProvider {
  readonly mode = 'sandbox' as const;
  readonly publicKeyId = null;
  private readonly logger = new Logger('SandboxPayments');

  constructor(private readonly env: EnvService) {}

  async createOrder(amountPaise: number, receipt: string): Promise<CreatedOrder> {
    const providerOrderId = `order_sandbox_${randomUUID()}`;
    if (this.env.env.NODE_ENV === 'development') {
      this.logger.warn(
        `[SANDBOX PAYMENTS] order ${providerOrderId} for receipt ${receipt}: ₹${(amountPaise / 100).toFixed(2)}`,
      );
    }
    return { providerOrderId };
  }

  /** The sandbox checkout screen calls WalletService, which signs with this same secret. */
  sign(providerOrderId: string, paymentId: string): string {
    return hmacHex(this.env.env.PAYMENTS_SANDBOX_SECRET, `${providerOrderId}|${paymentId}`);
  }

  verifyPaymentSignature(providerOrderId: string, paymentId: string, signature: string): boolean {
    try {
      return safeEqualHex(signature, this.sign(providerOrderId, paymentId));
    } catch {
      return false;
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      return safeEqualHex(signature, hmacHex(this.env.env.PAYMENTS_SANDBOX_SECRET, rawBody));
    } catch {
      return false;
    }
  }
}

/**
 * Real Razorpay Orders API, TEST mode only (D-020: the API refuses to boot with anything but
 * rzp_test_ keys). NOT verified against the real Razorpay service in this session — no live
 * account was used — same honesty as the MSG91 SMS adapter.
 */
@Injectable()
export class RazorpayPaymentsProvider implements PaymentsProvider {
  readonly mode = 'razorpay' as const;

  constructor(private readonly env: EnvService) {}

  get publicKeyId(): string {
    return this.env.env.RAZORPAY_KEY_ID ?? '';
  }

  async createOrder(amountPaise: number, receipt: string): Promise<CreatedOrder> {
    const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = this.env.env;
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay order creation responded ${res.status}`);
    const body = (await res.json()) as { id: string };
    return { providerOrderId: body.id };
  }

  /** Razorpay Checkout's documented scheme: HMAC-SHA256("order_id|payment_id", key_secret). */
  verifyPaymentSignature(providerOrderId: string, paymentId: string, signature: string): boolean {
    try {
      return safeEqualHex(
        signature,
        hmacHex(this.env.env.RAZORPAY_KEY_SECRET ?? '', `${providerOrderId}|${paymentId}`),
      );
    } catch {
      return false;
    }
  }

  /** Razorpay webhooks: HMAC-SHA256(raw body, webhook secret), sent in X-Razorpay-Signature. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      return safeEqualHex(signature, hmacHex(this.env.env.RAZORPAY_WEBHOOK_SECRET ?? '', rawBody));
    } catch {
      return false;
    }
  }
}

@Module({
  providers: [
    SandboxPaymentsProvider,
    RazorpayPaymentsProvider,
    {
      provide: PAYMENTS_PROVIDER,
      inject: [EnvService, SandboxPaymentsProvider, RazorpayPaymentsProvider],
      useFactory: (
        env: EnvService,
        sandbox: SandboxPaymentsProvider,
        razorpay: RazorpayPaymentsProvider,
      ): PaymentsProvider => (env.env.PAYMENTS_MODE === 'test' ? razorpay : sandbox),
    },
  ],
  exports: [PAYMENTS_PROVIDER, SandboxPaymentsProvider, RazorpayPaymentsProvider],
})
export class PaymentsAdapterModule {}
