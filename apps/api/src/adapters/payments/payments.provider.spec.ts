import { createHmac } from 'node:crypto';
import { EnvService } from '../../config/env.service';
import { RazorpayPaymentsProvider, SandboxPaymentsProvider } from './payments.provider';

function env(over: Partial<EnvService['env']> = {}): EnvService {
  return {
    env: {
      NODE_ENV: 'test',
      PAYMENTS_SANDBOX_SECRET: 'sandbox-secret-for-tests',
      RAZORPAY_KEY_ID: 'rzp_test_abc123',
      RAZORPAY_KEY_SECRET: 'razorpay-secret-for-tests',
      RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-secret-for-tests',
      ...over,
    },
  } as EnvService;
}

describe('SandboxPaymentsProvider', () => {
  it('creates an order id that identifies itself as sandbox, without calling any network', async () => {
    const p = new SandboxPaymentsProvider(env());
    const order = await p.createOrder(4900, 'receipt-1');
    expect(order.providerOrderId).toMatch(/^order_sandbox_/);
    expect(p.publicKeyId).toBeNull();
  });

  it('signs with a real HMAC, and the same inputs always verify (round-trip)', () => {
    const p = new SandboxPaymentsProvider(env());
    const sig = p.sign('order_sandbox_1', 'pay_sandbox_1');
    expect(p.verifyPaymentSignature('order_sandbox_1', 'pay_sandbox_1', sig)).toBe(true);
  });

  it('a signature for one order/payment pair does not verify a different pair (not a fixed "always true" stub)', () => {
    const p = new SandboxPaymentsProvider(env());
    const sig = p.sign('order_sandbox_1', 'pay_sandbox_1');
    expect(p.verifyPaymentSignature('order_sandbox_1', 'pay_sandbox_2', sig)).toBe(false);
    expect(p.verifyPaymentSignature('order_sandbox_2', 'pay_sandbox_1', sig)).toBe(false);
    expect(p.verifyPaymentSignature('order_sandbox_1', 'pay_sandbox_1', `${sig}x`)).toBe(false);
  });

  it('a signature made with a different secret is rejected', () => {
    const a = new SandboxPaymentsProvider(env({ PAYMENTS_SANDBOX_SECRET: 'secret-a' }));
    const b = new SandboxPaymentsProvider(env({ PAYMENTS_SANDBOX_SECRET: 'secret-b' }));
    const sig = a.sign('order_1', 'pay_1');
    expect(b.verifyPaymentSignature('order_1', 'pay_1', sig)).toBe(false);
  });

  it('webhook signature verification uses the same real HMAC scheme', () => {
    const p = new SandboxPaymentsProvider(env());
    const body = JSON.stringify({ event: 'payment.captured' });
    const goodSig = p.sign('', ''); // not how it's actually signed; just proves the mechanism differs
    expect(p.verifyWebhookSignature(body, goodSig)).toBe(false);

    const realSig = createHmac('sha256', 'sandbox-secret-for-tests').update(body).digest('hex');
    expect(p.verifyWebhookSignature(body, realSig)).toBe(true);
  });

  it('a non-hex signature never crashes verification, just fails it', () => {
    const p = new SandboxPaymentsProvider(env());
    expect(p.verifyPaymentSignature('order_1', 'pay_1', 'not-hex-at-all!!')).toBe(false);
    expect(p.verifyWebhookSignature('{}', 'not-hex-at-all!!')).toBe(false);
  });
});

describe('RazorpayPaymentsProvider (signature math only — no network calls in tests)', () => {
  it('exposes the real Checkout key id to hand the client', () => {
    const p = new RazorpayPaymentsProvider(env());
    expect(p.publicKeyId).toBe('rzp_test_abc123');
  });

  it("verifies Razorpay Checkout's documented scheme: HMAC-SHA256(order_id|payment_id, key_secret)", () => {
    const p = new RazorpayPaymentsProvider(env());
    const sig = createHmac('sha256', 'razorpay-secret-for-tests')
      .update('order_abc|pay_xyz')
      .digest('hex');
    expect(p.verifyPaymentSignature('order_abc', 'pay_xyz', sig)).toBe(true);
    expect(p.verifyPaymentSignature('order_abc', 'pay_xyz', `${sig}0`)).toBe(false);
    expect(p.verifyPaymentSignature('order_different', 'pay_xyz', sig)).toBe(false);
  });

  it('verifies webhooks with the separate webhook secret, not the API key secret', () => {
    const p = new RazorpayPaymentsProvider(env());
    const body = '{"event":"payment.captured"}';
    const withApiSecret = createHmac('sha256', 'razorpay-secret-for-tests')
      .update(body)
      .digest('hex');
    const withWebhookSecret = createHmac('sha256', 'razorpay-webhook-secret-for-tests')
      .update(body)
      .digest('hex');
    expect(p.verifyWebhookSignature(body, withApiSecret)).toBe(false);
    expect(p.verifyWebhookSignature(body, withWebhookSecret)).toBe(true);
  });
});
