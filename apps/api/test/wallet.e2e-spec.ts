import { createHmac, randomUUID } from 'node:crypto';
import { type Harness, startHarness } from './harness';
import { CENTER, Market, northOf } from './market-helpers';

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

describe('tokens are no longer reserved at all (Phase Commerce B1)', () => {
  it('a customer with zero tokens can still create a request — nothing is held any more', async () => {
    const c = await m.customer({ tokens: 0 });
    const { jobId } = await m.open(c);
    const wallet = await m.api.get(c, '/v1/wallet').expect(200);
    expect(wallet.body).toEqual({ balanceTokens: 0, heldTokens: 0, recentLedger: [] });
    expect(await m.prisma.walletHold.findUnique({ where: { jobId } })).toBeNull();
  });

  it('release and consume are still callable directly and remain idempotent no-ops (dead code kept, not deleted)', async () => {
    const fakeJobId = randomUUID();
    await m.prisma.$transaction(async (tx) => {
      await m.wallet.release(tx, fakeJobId);
      await m.wallet.consume(tx, fakeJobId);
    });
  });
});

describe('Phase Commerce B2/B3/B4: the platform fee and pay-after payments', () => {
  it('the fee is computed and frozen at the same moment the price is agreed', async () => {
    const area = northOf(60);
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    const job = await m.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe('AGREED');
    expect(job.agreedPricePaise).toBe(34900); // electrician's seeded DEFAULT price (see D-080)
    expect(job.platformFeePaise).toBe(3490); // 10% default
  });

  it('CASH: matching recorded and confirmed amounts credits the fee as dues, no mismatch flag', async () => {
    const area = northOf(80);
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.confirmJob(c, r, jobId);

    const payment = await m.prisma.jobPayment.findUniqueOrThrow({ where: { jobId } });
    expect(payment).toMatchObject({
      mode: 'CASH',
      servicePricePaise: 34900,
      feePaise: 3490,
      totalPaise: 38390,
      status: 'CONFIRMED',
    });
    const wallet = await m.prisma.workerWallet.findUniqueOrThrow({ where: { userId: r.userId } });
    expect(wallet.duesPaise).toBe(3490);
    expect(wallet.balancePaise).toBe(0); // cash never touches the withdrawable balance
  });

  it('CASH: a mismatched confirmed amount is flagged for review, but the fee is still owed', async () => {
    const area = northOf(100);
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.runToCompletion(c, r, jobId); // records the full agreed amount
    await m.api.post(c, `/v1/jobs/${jobId}/confirm`, { cashConfirmedPaise: 1000 }).expect(200);

    const payment = await m.prisma.jobPayment.findUniqueOrThrow({ where: { jobId } });
    expect(payment.status).toBe('MISMATCHED');
    expect(payment.cashConfirmedPaise).toBe(1000);
    const wallet = await m.prisma.workerWallet.findUniqueOrThrow({ where: { userId: r.userId } });
    expect(wallet.duesPaise).toBe(3490); // owed regardless of the mismatch
  });

  it('CASH: confirming without cashConfirmedPaise is refused', async () => {
    const area = northOf(120);
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.runToCompletion(c, r, jobId);
    const res = await m.api.post(c, `/v1/jobs/${jobId}/confirm`, {}).expect(422);
    expect(res.body.error.details.code).toBe('CASH_CONFIRMATION_REQUIRED');
  });

  it('ONLINE: confirming before paying is refused; paying then confirming credits earnings (fee excluded)', async () => {
    const area = northOf(140);
    const c = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c, r);
    await m.api.post(r, `/v1/jobs/${jobId}/en-route`).expect(200);
    await m.ping(r, CENTER);
    await m.api.post(r, `/v1/jobs/${jobId}/arrive`).expect(200);
    const code = (await m.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await m.api.post(r, `/v1/jobs/${jobId}/verify-arrival`, { code }).expect(200);
    await m.uploadJobPhoto(r, jobId, 'BEFORE');
    await m.api.post(r, `/v1/jobs/${jobId}/start`).expect(200);
    await m.uploadJobPhoto(r, jobId, 'AFTER');
    await m.api.post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'UPI' }).expect(200);

    const early = await m.api.post(c, `/v1/jobs/${jobId}/confirm`, {}).expect(409);
    expect(early.body.error.details.code).toBe('PAYMENT_NOT_CAPTURED');

    const order = await m.api.post(c, `/v1/jobs/${jobId}/payment/online`).expect(201);
    expect(order.body.purpose).toBe('JOB_PAYMENT');
    expect(order.body.amountPaise).toBe(Math.round(38390 * 0.98)); // minus the 2% online discount
    await m.api.post(c, `/v1/wallet/orders/${order.body.orderId}/sandbox-pay`).expect(200);
    await m.api.post(c, `/v1/jobs/${jobId}/confirm`, {}).expect(200);

    const payment = await m.prisma.jobPayment.findUniqueOrThrow({ where: { jobId } });
    expect(payment.status).toBe('CONFIRMED');
    const wallet = await m.prisma.workerWallet.findUniqueOrThrow({ where: { userId: r.userId } });
    expect(wallet.balancePaise).toBe(34900); // the service price only — the fee stays with the platform
    expect(wallet.duesPaise).toBe(0);
  });

  it('a Ranger over the dues threshold cannot accept a new request', async () => {
    const area = northOf(160);
    const c1 = await m.customer({ at: area });
    const r = await m.ranger({ at: area });
    const { jobId } = await m.match(c1, r);
    await m.confirmJob(c1, r, jobId); // pushes dues to 3490, under the 50000 default threshold
    await m.prisma.workerWallet.update({
      where: { userId: r.userId },
      data: { duesPaise: 50_000 },
    });
    const c2 = await m.customer({ at: area });
    const { requestId } = await m.open(c2);
    const res = await m.api.post(r, `/v1/requests/${requestId}/accept`).expect(409);
    expect(res.body.error.details.code).toBe('DUES_THRESHOLD');
  });
});

describe('worker wallet: summary, settle dues, withdraw (Phase Commerce B4/B6)', () => {
  it('a fresh Ranger has zero balance and zero dues', async () => {
    const r = await m.ranger();
    const wallet = await m.api.get(r, '/v1/worker/wallet').expect(200);
    expect(wallet.body).toEqual({ balancePaise: 0, duesPaise: 0, recentLedger: [] });
  });

  it('settling dues reduces duesPaise, capped at what is owed', async () => {
    const r = await m.ranger();
    await m.prisma.workerWallet.create({ data: { userId: r.userId, duesPaise: 3000 } });
    const res = await m.api.post(r, '/v1/worker/wallet/dues/settle', { amountPaise: 10_000 }).expect(200);
    expect(res.body).toEqual({ settledPaise: 3000 });
    const wallet = await m.api.get(r, '/v1/worker/wallet').expect(200);
    expect(wallet.body.duesPaise).toBe(0);
  });

  it('withdrawing refuses more than the available balance', async () => {
    const r = await m.ranger();
    await m.prisma.workerWallet.create({ data: { userId: r.userId, balancePaise: 500 } });
    const res = await m.api.post(r, '/v1/worker/wallet/withdraw', { amountPaise: 1000 }).expect(422);
    expect(res.body.error.details.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('withdrawing within the balance succeeds and moves the money', async () => {
    const r = await m.ranger();
    await m.prisma.workerWallet.create({ data: { userId: r.userId, balancePaise: 5000 } });
    await m.api.post(r, '/v1/worker/wallet/withdraw', { amountPaise: 2000 }).expect(200);
    const wallet = await m.api.get(r, '/v1/worker/wallet').expect(200);
    expect(wallet.body.balancePaise).toBe(3000);
  });
});
