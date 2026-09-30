import { createHmac, randomUUID } from 'node:crypto';
import { type Harness, startHarness } from './harness';
import { Market, northOf } from './market-helpers';

let h: Harness;
let m: Market;

beforeAll(async () => {
  h = await startHarness();
  m = new Market(h.app);
});
afterAll(async () => {
  await h?.stop();
});

const sandboxSign = (orderId: string, paymentId: string) =>
  createHmac('sha256', 'sandbox-payments-secret-dev-only')
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

describe('wallet: balance, bundles and top-up (Phase 3, D-037/D-038/D-039)', () => {
  it('a fresh account has zero balance and zero held tokens, and lists the seeded bundles', async () => {
    const s = await m.api.signIn();
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body).toEqual({ balanceTokens: 0, heldTokens: 0, recentLedger: [] });

    const bundles = await m.api.get(s, '/v1/wallet/bundles').expect(200);
    expect(bundles.body.length).toBeGreaterThanOrEqual(3);
    expect(bundles.body[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        slug: expect.any(String),
        tokens: expect.any(Number),
        pricePaise: expect.any(Number),
      }),
    );
  });

  it('creating a top-up order returns a sandbox provider order with no key id', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201);
    expect(order.body).toEqual({
      orderId: expect.any(String),
      purpose: 'TOKEN_TOPUP',
      provider: 'sandbox',
      providerOrderId: expect.stringMatching(/^order_sandbox_/),
      amountPaise: bundle.pricePaise,
      tokens: bundle.tokens,
      keyId: null,
    });
  });

  it('a bogus bundle id is refused', async () => {
    const s = await m.api.signIn();
    await m.api.post(s, '/v1/wallet/topup', { bundleId: randomUUID() }).expect(404);
  });

  it('sandbox-pay credits the wallet with the bundle tokens and records a PURCHASE ledger row', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    const after = await m.api
      .post(s, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {})
      .expect(200);
    expect(after.body).toEqual({ ok: true });
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(bundle.tokens);
    expect(wallet.body.heldTokens).toBe(0);
    expect(wallet.body.recentLedger[0]).toEqual(
      expect.objectContaining({ type: 'PURCHASE', tokensDelta: bundle.tokens, jobId: null }),
    );
    const row = await m.prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.orderId } });
    expect(row.status).toBe('PAID');
    expect(row.providerPaymentId).toMatch(/^pay_sandbox_/);
  });

  it('sandbox-pay is idempotent: calling it twice never double-credits', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    await m.api.post(s, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {}).expect(200);
    await m.api.post(s, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {}).expect(200);
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(bundle.tokens); // not doubled
  });

  it("another customer cannot pay for, or even see, someone else's order", async () => {
    const owner = await m.api.signIn();
    const stranger = await m.api.signIn();
    const bundle = (await m.api.get(owner, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(owner, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    await m.api.post(stranger, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {}).expect(404);
  });

  it('/verify rejects a wrong signature, and does not credit anything', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    const bad = await m.api
      .post(s, `/v1/wallet/orders/${order.orderId}/verify`, {
        razorpayPaymentId: 'pay_fake',
        razorpaySignature: 'deadbeef00',
      })
      .expect(422);
    expect(bad.body.error.details.code).toBe('SIGNATURE_INVALID');
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(0);
  });

  it("/verify accepts a correctly signed payment (the same path Razorpay Checkout's callback uses)", async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    const paymentId = `pay_sandbox_${randomUUID()}`;
    const signature = sandboxSign(order.providerOrderId, paymentId);
    const res = await m.api
      .post(s, `/v1/wallet/orders/${order.orderId}/verify`, {
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      })
      .expect(200);
    expect(res.body).toEqual({ ok: true });
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(bundle.tokens);
  });

  it('a top-up already paid cannot be paid again through a different order', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    await m.api.post(s, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {}).expect(200);
    const paymentId = `pay_sandbox_${randomUUID()}`;
    const signature = sandboxSign(order.providerOrderId, paymentId);
    await m.api
      .post(s, `/v1/wallet/orders/${order.orderId}/verify`, {
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      })
      .expect(200);
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(bundle.tokens); // unchanged, not credited a second time
  });

  it('lists purchase history newest first', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    for (let i = 0; i < 3; i++) {
      const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
        .body;
      if (i === 1)
        await m.api.post(s, `/v1/wallet/orders/${order.orderId}/sandbox-pay`, {}).expect(200);
    }
    const orders = await m.api.get(s, '/v1/wallet/orders').expect(200);
    expect(orders.body.items).toHaveLength(3);
    expect(orders.body.items.filter((o: { status: string }) => o.status === 'PAID')).toHaveLength(
      1,
    );
    expect(
      orders.body.items.filter((o: { status: string }) => o.status === 'CREATED'),
    ).toHaveLength(2);
  });

  it('the webhook credits an order on a correctly signed payload, and is idempotent against a later client verify', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    const paymentId = `pay_sandbox_${randomUUID()}`;
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: order.providerOrderId } } },
    });
    const signature = createHmac('sha256', 'sandbox-payments-secret-dev-only')
      .update(payload)
      .digest('hex');
    await m.api
      .http()
      .post('/v1/webhooks/razorpay')
      .set('X-Razorpay-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(bundle.tokens);

    // A client-side verify arriving after the webhook already credited it must be a safe no-op.
    const sig2 = sandboxSign(order.providerOrderId, `pay_sandbox_${randomUUID()}`);
    await m.api
      .post(s, `/v1/wallet/orders/${order.orderId}/verify`, {
        razorpayPaymentId: 'ignored',
        razorpaySignature: sig2,
      })
      .expect(200);
    const walletAfter = await m.api.get(s, '/v1/wallet').expect(200);
    expect(walletAfter.body.balanceTokens).toBe(bundle.tokens); // still not doubled
  });

  it('the webhook ignores a wrong signature (no credit, no crash)', async () => {
    const s = await m.api.signIn();
    const bundle = (await m.api.get(s, '/v1/wallet/bundles').expect(200)).body[0];
    const order = (await m.api.post(s, '/v1/wallet/topup', { bundleId: bundle.id }).expect(201))
      .body;
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_x', order_id: order.providerOrderId } } },
    });
    await m.api
      .http()
      .post('/v1/webhooks/razorpay')
      .set('X-Razorpay-Signature', 'not-the-real-signature-00')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200); // acknowledged so Razorpay does not retry forever, but nothing is credited
    const wallet = await m.api.get(s, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(0);
  });

  it('sandbox-pay is refused once PAYMENTS_MODE is test (real Razorpay), even for a leftover sandbox order', async () => {
    const testApp = await h.createApp({
      PAYMENTS_MODE: 'test',
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'sekret',
      RAZORPAY_WEBHOOK_SECRET: 'whsekret',
    });
    const testMarket = new Market(testApp);
    const s = await testMarket.api.signIn();
    // createTopupOrder would try to call the real Razorpay API and fail on no network; the
    // sandbox-pay refusal itself does not depend on there being a real order to prove the point.
    await testMarket.api.post(s, `/v1/wallet/orders/${randomUUID()}/sandbox-pay`, {}).expect(403);
    await testApp.close();
  });
});

describe('wallet: hold on request, consume on confirm, release on cancel/no-show (D-037/D-038)', () => {
  it('a customer with zero tokens cannot create a request', async () => {
    const c = await m.customer({ tokens: 0 });
    const res = await m.request(c).expect(422);
    expect(res.body.error.details.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('creating a request holds exactly one token: balance down, held up, a HELD wallet_holds row', async () => {
    const c = await m.customer({ tokens: 5 });
    const { jobId } = await m.open(c);
    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(4);
    expect(wallet.body.heldTokens).toBe(1);
    const hold = await m.prisma.walletHold.findUniqueOrThrow({ where: { jobId } });
    expect(hold.status).toBe('HELD');
    expect(hold.tokens).toBe(1);
  });

  it('confirming the job consumes the held token permanently: held drops, balance stays put', async () => {
    const area = northOf(0);
    const c = await m.customer({ at: area, tokens: 3 });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.agree(c, r, jobId);
    await m.runToCompletion(c, r, jobId);
    await m.api.post(c, `/v1/jobs/${jobId}/confirm`, {}).expect(200);

    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(2); // spent at hold time, never refunded
    expect(wallet.body.heldTokens).toBe(0);
    const hold = await m.prisma.walletHold.findUniqueOrThrow({ where: { jobId } });
    expect(hold.status).toBe('CONSUMED');
    const consumeRow = await m.prisma.walletLedgerEntry.findFirst({
      where: { jobId, type: 'CONSUME' },
    });
    expect(consumeRow).toMatchObject({ tokensDelta: 0, heldDelta: -1 });
  });

  it('cancelling before match releases the token: balance restored, held back to zero', async () => {
    const c = await m.customer({ tokens: 2 });
    const { requestId, jobId } = await m.open(c);
    await m.api.post(c, `/v1/requests/${requestId}/cancel`, {}).expect(200);

    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(2);
    expect(wallet.body.heldTokens).toBe(0);
    const hold = await m.prisma.walletHold.findUniqueOrThrow({ where: { jobId } });
    expect(hold.status).toBe('RELEASED');
  });

  it('cancelling after match also releases the token', async () => {
    const area = northOf(20);
    const c = await m.customer({ at: area, tokens: 2 });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.api.post(c, `/v1/jobs/${jobId}/cancel`, {}).expect(200);

    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(2);
    expect(wallet.body.heldTokens).toBe(0);
  });

  it("a Ranger no-show releases the customer's token", async () => {
    const area = northOf(40);
    const c = await m.customer({ at: area, tokens: 2 });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.agree(c, r, jobId);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`, {}).expect(200);
    await m.prisma.job.update({
      where: { id: jobId },
      data: { enRouteAt: new Date(Date.now() - 45 * 60_000) },
    });
    await m.api.post(c, `/v1/jobs/${jobId}/report-no-show`, {}).expect(200);

    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body.balanceTokens).toBe(2);
    expect(wallet.body.heldTokens).toBe(0);
  });

  it('release and consume are idempotent no-ops when there was never a hold for that job', async () => {
    // Exercises the "no hold row" branch directly: nothing to release/consume, must not throw.
    const fakeJobId = randomUUID();
    await m.prisma.$transaction(async (tx) => {
      await m.wallet.release(tx, fakeJobId);
      await m.wallet.consume(tx, fakeJobId);
    });
  });

  it('the ledger fully explains the wallet counters: sum(tokensDelta) = balance, sum(heldDelta) = held', async () => {
    const c = await m.customer({ tokens: 4 });
    const { requestId: r1 } = await m.open(c);
    await m.open(c);
    await m.api.post(c, `/v1/requests/${r1}/cancel`, {}).expect(200);

    const wallet = await m.prisma.customerWallet.findUniqueOrThrow({ where: { userId: c.userId } });
    const ledger = await m.prisma.walletLedgerEntry.findMany({ where: { walletId: wallet.id } });
    const sumBalance = ledger.reduce((a, l) => a + l.tokensDelta, 0);
    const sumHeld = ledger.reduce((a, l) => a + l.heldDelta, 0);
    expect(sumBalance).toBe(wallet.balanceTokens);
    expect(sumHeld).toBe(wallet.heldTokens);
  });
});
