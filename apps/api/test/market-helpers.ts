import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { FeeService } from '../src/marketplace/fee.service';
import { MatchingService } from '../src/marketplace/matching.service';
import { MarketplaceConfig } from '../src/marketplace/marketplace-config.service';
import { SchedulerService } from '../src/marketplace/scheduler.service';
import { ReputationService } from '../src/reputation/reputation.service';
import { WalletService } from '../src/wallet/wallet.service';
import { Api, type Session } from './helpers';

/** Chennai Central. 0.001 degrees of latitude is about 111 m. */
export const CENTER = { lat: 13.0827, lng: 80.2707 };
export const northOf = (metres: number, from = CENTER) => ({
  lat: from.lat + metres / 111_000,
  lng: from.lng,
});

export interface Customer extends Session {
  addressId: string;
}
export interface Ranger extends Session {
  lat: number;
  lng: number;
}

export class Market {
  readonly api: Api;
  constructor(readonly app: INestApplication) {
    this.api = new Api(app);
  }
  get prisma() {
    return this.api.prisma();
  }
  get matching() {
    return this.app.get(MatchingService);
  }
  get scheduler() {
    return this.app.get(SchedulerService);
  }
  get config() {
    return this.app.get(MarketplaceConfig);
  }
  get fee() {
    return this.app.get(FeeService);
  }

  /** D-087/D-095: flips the quote-first flow on for tests that specifically exercise it. The
   * flag's own production default is now true (D-095), but harness.ts pins it back to false for
   * every e2e file right after seeding, so every OTHER test here still gets the D-080 auto-agree
   * -at-the-listed-price behaviour unless it calls this itself. Call this in a `beforeAll`/
   * `beforeEach`, not mid-test — accept() reads the flag at the moment a Ranger accepts. */
  async enableQuoteFlow(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'quote_flow_enabled' },
      update: { value: true },
      create: { key: 'quote_flow_enabled', value: true },
    });
    this.fee.refresh();
  }

  async disableQuoteFlow(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'quote_flow_enabled' },
      update: { value: false },
      create: { key: 'quote_flow_enabled', value: false },
    });
    this.fee.refresh();
  }

  /** D-087 (H1): cash defaults to disabled, same reasoning as quote_flow_enabled — most tests
   * here are not ABOUT cash, they just use it (via runToCompletion/confirmJob below) as a
   * convenient default payment method, same as before D-087. Rather than touch every call
   * site, `runToCompletion` enables it for the duration automatically; a test specifically
   * about the disabled behaviour calls `disableCash()` itself afterward. */
  async enableCash(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'cash_enabled' },
      update: { value: true },
      create: { key: 'cash_enabled', value: true },
    });
    this.fee.refresh();
  }

  async disableCash(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'cash_enabled' },
      update: { value: false },
      create: { key: 'cash_enabled', value: false },
    });
    this.fee.refresh();
  }

  /** D-087 (H2/H3): requires the completion code to confirm an ONLINE job. Same default-false,
   * flip-for-the-one-test-that-needs-it pattern as quote flow/cash above. */
  async enableCompletionOtp(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'completion_otp_enabled' },
      update: { value: true },
      create: { key: 'completion_otp_enabled', value: true },
    });
    this.fee.refresh();
  }

  async disableCompletionOtp(): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key: 'completion_otp_enabled' },
      update: { value: false },
      create: { key: 'completion_otp_enabled', value: false },
    });
    this.fee.refresh();
  }

  async customer(
    over: { at?: { lat: number; lng: number }; located?: boolean; tokens?: number } = {},
  ): Promise<Customer> {
    const s = await this.api.signIn();
    const at = over.at ?? CENTER;
    const body = {
      label: 'Home',
      line1: '12 Gandhi Road',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600042',
    };
    const res = await this.api.post(
      s,
      '/v1/me/addresses',
      over.located === false ? body : { ...body, latitude: at.lat, longitude: at.lng },
    );
    if (res.status !== 201)
      throw new Error(`address failed ${res.status} ${JSON.stringify(res.body)}`);
    await this.api.patch(s, '/v1/me', { fullName: 'Asha Raman' });
    // Plenty of tokens by default (Phase 3, D-037/D-038) so marketplace tests don't have to think
    // about the wallet unless they are specifically testing it; pass tokens: 0 to opt out.
    await this.grantTokens(s.userId, over.tokens ?? 1000);
    return { ...s, addressId: res.body.id };
  }

  /** Credit tokens directly (an admin ADJUSTMENT, not a real purchase) so tests can set up quickly. */
  async grantTokens(userId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    const wallet = await this.prisma.customerWallet.upsert({
      where: { userId },
      update: { balanceTokens: { increment: tokens } },
      create: { userId, balanceTokens: tokens },
    });
    await this.prisma.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'ADJUSTMENT',
        tokensDelta: tokens,
        heldDelta: 0,
        note: 'test grant',
      },
    });
  }

  get wallet() {
    return this.app.get(WalletService);
  }

  /** A verified (tier 2), categorised Ranger, online at a point. Built directly so tests stay fast. */
  async ranger(
    over: {
      categories?: string[];
      at?: { lat: number; lng: number };
      tier?: number;
      online?: boolean;
      gender?: 'FEMALE' | 'MALE';
      name?: string;
    } = {},
  ): Promise<Ranger> {
    const s = await this.api.signIn();
    const at = over.at ?? CENTER;
    await this.api.patch(s, '/v1/me', { fullName: over.name ?? 'Ravi Kumar' });
    await this.api.post(s, '/v1/me/roles', { role: 'WORKER' });
    await this.prisma.workerProfile.update({
      where: { userId: s.userId },
      data: { kycTier: over.tier ?? 2, gender: over.gender ?? null },
    });
    await this.api.patch(s, '/v1/worker/profile', {
      categorySlugs: over.categories ?? ['electrician'],
    });
    // Rangers can also be customers on the same account, so grant tokens too (D-037), matching
    // Market.customer(); tests that open a request as this Ranger don't need to think about it.
    await this.grantTokens(s.userId, 1000);
    const r: Ranger = { ...s, lat: at.lat, lng: at.lng };
    if (over.online !== false) {
      const res = await this.api.post(r, '/v1/worker/online', {
        latitude: at.lat,
        longitude: at.lng,
      });
      if (res.status !== 200)
        throw new Error(`go online failed ${res.status} ${JSON.stringify(res.body)}`);
    }
    return r;
  }

  request(c: Customer, over: Record<string, unknown> = {}) {
    return this.api.post(c, '/v1/requests', {
      categorySlug: 'electrician',
      description: 'Ceiling fan is not working, sparks when switched on',
      addressId: c.addressId,
      urgency: 'IMMEDIATE',
      ...over,
    });
  }

  /** Create an immediate request and return {requestId, jobId, dto}. */
  async open(c: Customer, over: Record<string, unknown> = {}) {
    const res = await this.request(c, over);
    if (res.status !== 201)
      throw new Error(`request failed ${res.status} ${JSON.stringify(res.body)}`);
    return { requestId: res.body.requestId as string, jobId: res.body.id as string, dto: res.body };
  }

  incoming(r: Ranger) {
    return this.api.get(r, '/v1/worker/incoming');
  }

  /** Move the ranger's heartbeat point (a phone sending location). */
  ping(r: Ranger, at: { lat: number; lng: number }, accuracyM = 8) {
    return this.api.post(r, '/v1/worker/location', {
      latitude: at.lat,
      longitude: at.lng,
      accuracyM,
    });
  }

  /** Match a job to a Ranger through the real accept endpoint and return the Ranger's job view. */
  async match(c: Customer, r: Ranger, over: Record<string, unknown> = {}) {
    const { requestId, jobId } = await this.open(c, over);
    const acc = await this.api.post(r, `/v1/requests/${requestId}/accept`);
    if (acc.status !== 200)
      throw new Error(`accept failed ${acc.status} ${JSON.stringify(acc.body)}`);
    return { requestId, jobId };
  }

  /**
   * D-080: `match()` already agrees the job automatically, at its frozen listed price, in the
   * same transaction as the accept — there is no separate negotiation step to drive through the
   * API any more. This helper now exists only so every pre-D-080 caller (which calls it right
   * after `match()` expecting an AGREED job back) keeps working unchanged; passing `amountPaise`
   * overwrites the agreed price directly, the same kind of test-only shortcut as `grantTokens`.
   */
  async agree(c: Customer, _r: Ranger, jobId: string, amountPaise?: number) {
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    if (job.status !== 'AGREED')
      throw new Error(
        `agree() called on a job that is ${job.status}, not AGREED (D-080: matching now agrees automatically)`,
      );
    if (amountPaise !== undefined && amountPaise !== job.agreedPricePaise)
      await this.prisma.job.update({ where: { id: jobId }, data: { agreedPricePaise: amountPaise } });
    return (await this.api.get(c, `/v1/jobs/${jobId}`)).body;
  }

  /** Upload a real file through a presigned URL and confirm it. */
  async uploadMedia(s: Session, kind: 'PHOTO' | 'VOICE', size = 2048, durationSeconds?: number) {
    const contentType = kind === 'PHOTO' ? 'image/jpeg' : 'audio/mp4';
    const body = randomBytes(size);
    const p = await this.api.post(s, '/v1/requests/media', {
      kind,
      contentType,
      sizeBytes: size,
      ...(durationSeconds ? { durationSeconds } : {}),
    });
    if (p.status !== 200)
      throw new Error(`media presign failed ${p.status} ${JSON.stringify(p.body)}`);
    const put = await fetch(p.body.uploadUrl, { method: 'PUT', headers: p.body.headers, body });
    if (put.status !== 200) throw new Error(`media put failed ${put.status}`);
    const conf = await this.api.post(s, `/v1/requests/media/${p.body.mediaId}/confirm`);
    if (conf.status !== 200) throw new Error(`media confirm failed ${conf.status}`);
    return p.body.mediaId as string;
  }

  async uploadJobPhoto(r: Ranger, jobId: string, kind: 'BEFORE' | 'AFTER' | 'SELFIE') {
    const size = 1500;
    const p = await this.api.post(r, `/v1/jobs/${jobId}/photos`, {
      kind,
      contentType: 'image/jpeg',
      sizeBytes: size,
    });
    if (p.status !== 200) return p;
    const put = await fetch(p.body.uploadUrl, {
      method: 'PUT',
      headers: p.body.headers,
      body: randomBytes(size),
    });
    if (put.status !== 200) throw new Error(`job photo put failed ${put.status}`);
    return this.api.post(r, `/v1/jobs/${jobId}/photos/${p.body.photoId}/confirm`);
  }

  /** Drive a job from AGREED to COMPLETED_BY_WORKER through the real endpoints. Pays CASH,
   * recording exactly the agreed price + fee as collected (Phase Commerce B3) — a test that wants
   * a mismatch drives complete()/confirm() directly instead of through this helper. */
  async runToCompletion(c: Customer, r: Ranger, jobId: string, cashCollectedPaise?: number) {
    await this.enableCash(); // D-087: disabled by default; this helper's whole point is CASH.
    await this.api.post(r, `/v1/jobs/${jobId}/en-route`).then((x) => expectOk(x, 'en-route'));
    await this.ping(r, CENTER); // the customer's address is at CENTER
    await this.api.post(r, `/v1/jobs/${jobId}/arrive`).then((x) => expectOk(x, 'arrive'));
    const code = (await this.api.get(c, `/v1/jobs/${jobId}`)).body.arrivalCode as string;
    await this.api
      .post(r, `/v1/jobs/${jobId}/verify-arrival`, { code })
      .then((x) => expectOk(x, 'verify'));
    await this.uploadJobPhoto(r, jobId, 'BEFORE').then((x) => expectOk(x, 'before photo'));
    await this.api.post(r, `/v1/jobs/${jobId}/start`).then((x) => expectOk(x, 'start'));
    await this.uploadJobPhoto(r, jobId, 'AFTER').then((x) => expectOk(x, 'after photo'));
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    const collected =
      cashCollectedPaise ?? (job.agreedPricePaise ?? 0) + (job.platformFeePaise ?? 0);
    await this.api
      .post(r, `/v1/jobs/${jobId}/complete`, { paymentMethod: 'CASH', cashCollectedPaise: collected })
      .then((x) => expectOk(x, 'complete'));
  }

  /** Runs a job all the way to CONFIRMED_BY_CUSTOMER (Phase 4 tests usually just want this).
   * Confirms the exact cash amount runToCompletion recorded, so this stays a clean no-mismatch
   * happy path by default. */
  async confirmJob(c: Customer, r: Ranger, jobId: string): Promise<void> {
    await this.runToCompletion(c, r, jobId);
    const payment = await this.prisma.jobPayment.findUniqueOrThrow({ where: { jobId } });
    await this.api
      .post(c, `/v1/jobs/${jobId}/confirm`, { cashConfirmedPaise: payment.cashRecordedPaise })
      .then((x) => expectOk(x, 'confirm'));
    // D-078: confirm()'s league recompute runs after the HTTP response, not before — tests that
    // check league/wallet state right after confirmJob() need this settled first.
    await this.app.get(ReputationService).drainPendingRecomputes();
  }
}

export function expectOk(res: { status: number; body: unknown }, what: string): void {
  if (res.status >= 300)
    throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.body)}`);
}
