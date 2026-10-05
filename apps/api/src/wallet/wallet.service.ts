import { Inject, Injectable } from '@nestjs/common';
import type { ListingKind, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { decodeCursor, toPage } from '@haggler/shared';
import { PAYMENTS_PROVIDER, type PaymentsProvider } from '../adapters/payments/payments.provider';
import { conflict, forbidden, notFound, unprocessable } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { MonetizationConfig } from '../monetization/monetization-config.service';
import { PlusService } from '../monetization/plus.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * The customer/employer wallet and payments pipeline (Phase 3 tokens, D-037/D-038/D-039; Phase 9
 * monetization, D-069). Rangers/students/contract workers are never charged anything through any
 * of this (D-037/D-054/D-062) — every method here is called with a CUSTOMER's or EMPLOYER's own
 * userId, never a worker's.
 *
 * One order pipeline serves four purposes (PaymentOrder.purpose): TOKEN_TOPUP (Phase 3, unchanged
 * bookkeeping below), PLUS_SUBSCRIPTION, RUSH_FEE and BOOSTED_LISTING (Phase 9). Every purpose goes
 * through the same createOrder -> verifyOrder/sandboxPayOrder/webhook -> credit() pipeline; only
 * credit()'s dispatch differs per purpose. This is why the four create*Order methods below are thin
 * (validate + price + createOrder) and all the actual effects live in one place (credit()).
 *
 * Token bookkeeping, always kept consistent in one transaction:
 *   PURCHASE   balance += N                (a top-up was paid for)
 *   HOLD       balance -= 1, held += 1      (a request was created: reserve one token)
 *   RELEASE    balance += 1, held -= 1      (the job never confirmed: give the token back)
 *   CONSUME             held -= 1           (the job was confirmed: the token is permanently spent)
 *   ADJUSTMENT balance += N (N may be negative; admin-only manual correction, not built yet)
 *
 * Every change also appends a WalletLedgerEntry (append-only, DB trigger enforced) recording both
 * deltas, so the ledger alone can always reconstruct the wallet's current counters.
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
    private readonly env: EnvService,
    private readonly plus: PlusService,
    private readonly monetization: MonetizationConfig,
  ) {}

  // ---- reads ---------------------------------------------------------------------------------

  private async getOrCreate(userId: string) {
    const existing = await this.prisma.customerWallet.findUnique({ where: { userId } });
    if (existing) return existing;
    // Two concurrent first-touches (e.g. a race between opening the wallet screen and creating a
    // request) could both try to create the row; let the unique constraint pick a winner.
    try {
      return await this.prisma.customerWallet.create({ data: { userId } });
    } catch {
      return this.prisma.customerWallet.findUniqueOrThrow({ where: { userId } });
    }
  }

  async summary(userId: string) {
    const wallet = await this.getOrCreate(userId);
    const ledger = await this.prisma.walletLedgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      balanceTokens: wallet.balanceTokens,
      heldTokens: wallet.heldTokens,
      recentLedger: ledger.map((l) => ({
        id: l.id,
        type: l.type,
        tokensDelta: l.tokensDelta,
        jobId: l.jobId,
        note: l.note,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  /** Bundle prices with a Haggler Plus discount applied live if the caller has an active
   * membership (D-069) — never stored per-bundle, just a read-time multiply. */
  async listBundles(userId?: string) {
    const rows = await this.prisma.tokenBundle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    const discountBps = userId ? await this.activeDiscountBps(userId) : 0;
    return rows.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      tokens: b.tokens,
      pricePaise: applyDiscount(b.pricePaise, discountBps),
    }));
  }

  private async activeDiscountBps(userId: string): Promise<number> {
    const m = await this.plus.myMembership(userId);
    return m?.active ? m.tokenDiscountBps : 0;
  }

  async listOrders(userId: string, cursor: string | undefined, limit: number) {
    const c = cursor ? decodeCursor(cursor) : null;
    const after = c
      ? {
          OR: [
            { createdAt: { lt: new Date(c.k) } },
            { createdAt: new Date(c.k), id: { lt: c.id } },
          ],
        }
      : {};
    const rows = await this.prisma.paymentOrder.findMany({
      where: { AND: [{ userId }, after] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { bundle: { select: { name: true } }, plan: { select: { name: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((o) => ({
        id: o.id,
        purpose: o.purpose,
        itemName: o.bundle?.name ?? o.plan?.name ?? purposeLabel(o.purpose),
        tokens: o.tokens,
        amountPaise: o.amountPaise,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ---- create order: one per purpose, all thin (validate + price + createOrder) ------------

  async createTopupOrder(userId: string, bundleId: string) {
    const bundle = await this.prisma.tokenBundle.findFirst({
      where: { id: bundleId, isActive: true },
    });
    if (!bundle) throw notFound('That token bundle is not available.');
    const discountBps = await this.activeDiscountBps(userId);
    const amountPaise = applyDiscount(bundle.pricePaise, discountBps);
    return this.startOrder(userId, {
      purpose: 'TOKEN_TOPUP',
      amountPaise,
      receipt: `topup:${userId}`,
      bundleId: bundle.id,
      tokens: bundle.tokens,
    });
  }

  /** Haggler Plus subscription, customer or employer (D-069). A renewal while still active extends
   * expiresAt on credit — see the PlusMembership branch of credit() — so this just prices+creates. */
  async createSubscriptionOrder(userId: string, planId: string) {
    const plan = await this.prisma.plusPlan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw notFound('That plan is not available.');
    return this.startOrder(userId, {
      purpose: 'PLUS_SUBSCRIPTION',
      amountPaise: plan.pricePaise,
      receipt: `plus:${userId}`,
      planId: plan.id,
    });
  }

  /** Rush fee: a customer paying to skip wave sequencing on one of their own open requests
   * (D-069). Refused if the job isn't theirs, is already rush (paid or via Plus), or is no longer
   * broadcasting (already matched/cancelled/etc — there's nothing left to speed up). */
  async createRushOrder(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.customerId !== userId) throw notFound('Request not found');
    if (!['REQUESTED', 'BROADCASTING'].includes(job.status))
      throw conflict('This request is no longer broadcasting.', { code: 'NOT_BROADCASTING' });
    if (job.isRush)
      throw conflict('This request is already using the fastest broadcast.', {
        code: 'ALREADY_RUSH',
      });
    const cfg = await this.monetization.get();
    return this.startOrder(userId, {
      purpose: 'RUSH_FEE',
      amountPaise: cfg.rush_fee_paise,
      receipt: `rush:${userId}`,
      targetJobId: job.id,
    });
  }

  /** Boosted listing fee: an employer paying for higher placement of one of their own Contract or
   * Campus listings (D-069). Refused if the listing isn't theirs, isn't OPEN, or is already
   * boosted (no stacking — buy again once the current boost expires). */
  async createBoostOrder(userId: string, listingType: ListingKind, listingId: string) {
    const employer = await this.prisma.employerProfile.findUnique({ where: { userId } });
    if (!employer)
      throw unprocessable('Set your business name first.', { code: 'EMPLOYER_PROFILE_REQUIRED' });
    const listing =
      listingType === 'CONTRACT'
        ? await this.prisma.contractListing.findUnique({ where: { id: listingId } })
        : await this.prisma.campusListing.findUnique({ where: { id: listingId } });
    if (!listing || listing.employerId !== employer.id) throw notFound('Listing not found');
    if (listing.status !== 'OPEN')
      throw conflict('Only an OPEN listing can be boosted.', { code: 'LISTING_NOT_BOOSTABLE' });
    if (listing.boostedUntil && listing.boostedUntil.getTime() > Date.now())
      throw conflict('This listing is already boosted.', { code: 'ALREADY_BOOSTED' });
    const cfg = await this.monetization.get();
    return this.startOrder(userId, {
      purpose: 'BOOSTED_LISTING',
      amountPaise: cfg.boost_fee_paise,
      receipt: `boost:${userId}`,
      targetListingType: listingType,
      targetListingId: listing.id,
    });
  }

  private async startOrder(
    userId: string,
    opts: {
      purpose: 'TOKEN_TOPUP' | 'PLUS_SUBSCRIPTION' | 'RUSH_FEE' | 'BOOSTED_LISTING';
      amountPaise: number;
      receipt: string;
      bundleId?: string;
      tokens?: number;
      planId?: string;
      targetJobId?: string;
      targetListingType?: ListingKind;
      targetListingId?: string;
    },
  ) {
    const created = await this.payments.createOrder(
      opts.amountPaise,
      `${opts.receipt}:${randomUUID()}`,
    );
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        purpose: opts.purpose,
        amountPaise: opts.amountPaise,
        provider: this.payments.mode,
        providerOrderId: created.providerOrderId,
        bundleId: opts.bundleId,
        tokens: opts.tokens,
        planId: opts.planId,
        targetJobId: opts.targetJobId,
        targetListingType: opts.targetListingType,
        targetListingId: opts.targetListingId,
      },
    });
    return {
      orderId: order.id,
      purpose: order.purpose,
      provider: this.payments.mode,
      providerOrderId: order.providerOrderId,
      amountPaise: order.amountPaise,
      tokens: order.tokens,
      keyId: this.payments.publicKeyId,
    };
  }

  // ---- verify / sandbox-pay / webhook: purpose-agnostic, dispatch happens in credit() ------

  /** Client-side verification path: the Razorpay Checkout success callback (or the sandbox screen).
   * Works for any purpose — the order itself already says what it was for. */
  async verifyOrder(userId: string, orderId: string, paymentId: string, signature: string) {
    const order = await this.prisma.paymentOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw notFound('Order not found');
    if (order.status === 'PAID') return { ok: true as const }; // idempotent: webhook may have won the race
    if (order.status !== 'CREATED')
      throw conflict('This order can no longer be paid.', { code: 'ORDER_NOT_PAYABLE' });
    if (!this.payments.verifyPaymentSignature(order.providerOrderId, paymentId, signature))
      throw unprocessable('Payment could not be verified.', { code: 'SIGNATURE_INVALID' });
    await this.credit(order.id, order.providerOrderId, paymentId);
    return { ok: true as const };
  }

  /**
   * Dev/test convenience only, exactly like the sandbox SMS provider printing the OTP: there is no
   * real gateway to redirect to in sandbox mode, so the mobile app asks the API to sign a payment
   * id itself and immediately runs it through the SAME verification path as a real payment. Refused
   * outside PAYMENTS_MODE=sandbox.
   */
  async sandboxPayOrder(userId: string, orderId: string) {
    if (this.env.env.PAYMENTS_MODE !== 'sandbox')
      throw forbidden('Sandbox payment is not available in this environment.');
    const order = await this.prisma.paymentOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw notFound('Order not found');
    if (order.provider !== 'sandbox') throw forbidden('Not a sandbox order.');
    const sandbox = this.payments as unknown as {
      sign(orderId: string, paymentId: string): string;
    };
    const paymentId = `pay_sandbox_${randomUUID()}`;
    const signature = sandbox.sign(order.providerOrderId, paymentId);
    return this.verifyOrder(userId, orderId, paymentId, signature);
  }

  /** Server-to-server webhook path: the authoritative source, independent of the client's network. */
  async handleWebhook(rawBody: string, signature: string): Promise<void> {
    if (!this.payments.verifyWebhookSignature(rawBody, signature))
      throw unprocessable('Webhook signature invalid.', { code: 'SIGNATURE_INVALID' });
    const payload = JSON.parse(rawBody) as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
    };
    if (payload.event !== 'payment.captured') return; // only interested in successful captures
    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id || !entity.id) return;
    const order = await this.prisma.paymentOrder.findFirst({
      where: { provider: this.payments.mode, providerOrderId: entity.order_id },
    });
    if (!order || order.status === 'PAID') return; // unknown or already credited (idempotent)
    await this.credit(order.id, entity.order_id, entity.id);
  }

  /**
   * Race-safe credit: whichever of (client verify, webhook) arrives first wins; the other no-ops.
   * Marks the order PAID, then applies exactly one effect based on `purpose` — this is the one
   * place all four purposes' money-to-effect logic lives.
   */
  private async credit(orderId: string, providerOrderId: string, paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: 'CREATED' },
        data: { status: 'PAID', paidAt: new Date(), providerPaymentId: paymentId },
      });
      if (res.count !== 1) return; // someone else (webhook or a retried verify call) already credited it
      const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      switch (order.purpose) {
        case 'TOKEN_TOPUP':
          await this.creditTokenTopup(tx, order, providerOrderId);
          break;
        case 'PLUS_SUBSCRIPTION':
          await this.creditPlusSubscription(tx, order);
          break;
        case 'RUSH_FEE':
          await this.creditRushFee(tx, order);
          break;
        case 'BOOSTED_LISTING':
          await this.creditBoostedListing(tx, order);
          break;
      }
    });
  }

  private async creditTokenTopup(
    tx: Tx,
    order: { id: string; userId: string; tokens: number | null },
    providerOrderId: string,
  ): Promise<void> {
    const tokens = order.tokens ?? 0;
    const wallet = await tx.customerWallet.upsert({
      where: { userId: order.userId },
      update: {},
      create: { userId: order.userId },
    });
    await tx.customerWallet.update({
      where: { id: wallet.id },
      data: { balanceTokens: { increment: tokens } },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'PURCHASE',
        tokensDelta: tokens,
        heldDelta: 0,
        paymentOrderId: order.id,
        note: `${tokens} tokens via ${providerOrderId}`,
      },
    });
  }

  /** Grants/extends a PlusMembership. Renewing while still active extends from the current
   * expiresAt, not from now, so early renewal never costs the customer/employer days they already
   * paid for. */
  private async creditPlusSubscription(
    tx: Tx,
    order: { userId: string; planId: string | null },
  ): Promise<void> {
    if (!order.planId) return; // defensive; createSubscriptionOrder always sets it
    const plan = await tx.plusPlan.findUniqueOrThrow({ where: { id: order.planId } });
    const existing = await tx.plusMembership.findUnique({ where: { userId: order.userId } });
    const base =
      existing && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + plan.durationDays * 86_400_000);
    await tx.plusMembership.upsert({
      where: { userId: order.userId },
      update: { planId: plan.id, expiresAt },
      create: { userId: order.userId, planId: plan.id, expiresAt },
    });
  }

  /** Marks the job rush: one wave at the widest configured radius, no further waves (D-069). The
   * scheduler picks it up on its next tick since nextWaveAt is set to now. A no-op (not an error)
   * if the job left BROADCASTING between order-creation and payment — the money was still real,
   * but there's nothing left to speed up; refunding a paid-but-useless rush fee is a known gap. */
  private async creditRushFee(tx: Tx, order: { targetJobId: string | null }): Promise<void> {
    if (!order.targetJobId) return;
    await tx.job.updateMany({
      where: { id: order.targetJobId, status: { in: ['REQUESTED', 'BROADCASTING'] } },
      data: { isRush: true, nextWaveAt: new Date() },
    });
  }

  /** Sets boostedUntil on the target listing (D-069). Same "no-op if it's no longer boostable"
   * stance as rush — see creditRushFee. */
  private async creditBoostedListing(
    tx: Tx,
    order: { targetListingType: ListingKind | null; targetListingId: string | null },
  ): Promise<void> {
    if (!order.targetListingType || !order.targetListingId) return;
    const cfg = await this.monetization.get();
    const boostedUntil = new Date(Date.now() + cfg.boost_duration_days * 86_400_000);
    if (order.targetListingType === 'CONTRACT') {
      await tx.contractListing.updateMany({
        where: { id: order.targetListingId, status: 'OPEN' },
        data: { boostedUntil },
      });
    } else {
      await tx.campusListing.updateMany({
        where: { id: order.targetListingId, status: 'OPEN' },
        data: { boostedUntil },
      });
    }
  }

  // ---- hold / consume / release: called from the marketplace, inside its own transactions -----

  /** Reserve one token for a new request. Throws if the customer has none available. */
  async hold(tx: Tx, customerId: string, jobId: string): Promise<void> {
    // upsert cannot run through the outer transaction's isolation the same way twice concurrently
    // for two DIFFERENT jobs of the same brand-new customer, so this mirrors JobTransitions.move()'s
    // optimistic pattern: try the guarded decrement, and only fetch/create the wallet if needed.
    let wallet = await tx.customerWallet.findUnique({ where: { userId: customerId } });
    if (!wallet) wallet = await tx.customerWallet.create({ data: { userId: customerId } });
    const res = await tx.customerWallet.updateMany({
      where: { id: wallet.id, balanceTokens: { gte: 1 } },
      data: { balanceTokens: { decrement: 1 }, heldTokens: { increment: 1 } },
    });
    if (res.count !== 1)
      throw unprocessable('You need at least one token to make a request. Buy more in Wallet.', {
        code: 'INSUFFICIENT_TOKENS',
      });
    await tx.walletHold.create({ data: { walletId: wallet.id, jobId, tokens: 1, status: 'HELD' } });
    await tx.walletLedgerEntry.create({
      data: { walletId: wallet.id, type: 'HOLD', tokensDelta: -1, heldDelta: 1, jobId },
    });
  }

  /** The job was confirmed: the held token is permanently spent. No-op if there was no hold. */
  async consume(tx: Tx, jobId: string): Promise<void> {
    const res = await tx.walletHold.updateMany({
      where: { jobId, status: 'HELD' },
      data: { status: 'CONSUMED' },
    });
    if (res.count !== 1) return;
    const hold = await tx.walletHold.findUniqueOrThrow({ where: { jobId } });
    await tx.customerWallet.update({
      where: { id: hold.walletId },
      data: { heldTokens: { decrement: hold.tokens } },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: hold.walletId,
        type: 'CONSUME',
        tokensDelta: 0,
        heldDelta: -hold.tokens,
        jobId,
      },
    });
  }

  /** The job ended without confirming: give the held token back. No-op if there was no hold. */
  async release(tx: Tx, jobId: string): Promise<void> {
    const res = await tx.walletHold.updateMany({
      where: { jobId, status: 'HELD' },
      data: { status: 'RELEASED' },
    });
    if (res.count !== 1) return;
    const hold = await tx.walletHold.findUniqueOrThrow({ where: { jobId } });
    await tx.customerWallet.update({
      where: { id: hold.walletId },
      data: { balanceTokens: { increment: hold.tokens }, heldTokens: { decrement: hold.tokens } },
    });
    await tx.walletLedgerEntry.create({
      data: {
        walletId: hold.walletId,
        type: 'RELEASE',
        tokensDelta: hold.tokens,
        heldDelta: -hold.tokens,
        jobId,
      },
    });
  }

  /** True if the customer currently has an active Plus membership — used at request creation to
   * grant priority broadcast (same mechanism as a paid Rush fee, D-069) for free to Plus members. */
  async hasActivePlus(userId: string): Promise<boolean> {
    const m = await this.plus.myMembership(userId);
    return m?.active ?? false;
  }

  /**
   * The one place a worker's own userId is used in this file (D-076, Phase 11): a league-up
   * bonus, paying a Ranger for reaching a new league — or, since D-077 (Phase 12), the same
   * mechanism paying a client for reaching a new client league. Still consistent with "Rangers
   * are never charged" above — this only ever credits, for either side. Reuses the same wallet
   * row a Ranger already has from being auto-granted the CUSTOMER role at sign-up
   * (users/auth.service.ts findOrCreateUser), so no Ranger-specific wallet model was needed.
   */
  async grantLeagueBonus(tx: Tx, userId: string, tokens: number, note: string): Promise<void> {
    if (tokens <= 0) return;
    const wallet = await tx.customerWallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    await tx.customerWallet.update({
      where: { id: wallet.id },
      data: { balanceTokens: { increment: tokens } },
    });
    await tx.walletLedgerEntry.create({
      data: { walletId: wallet.id, type: 'BONUS', tokensDelta: tokens, heldDelta: 0, note },
    });
  }
}

function applyDiscount(pricePaise: number, discountBps: number): number {
  if (discountBps <= 0) return pricePaise;
  return Math.max(0, Math.round((pricePaise * (10_000 - discountBps)) / 10_000));
}

function purposeLabel(purpose: string): string {
  switch (purpose) {
    case 'PLUS_SUBSCRIPTION':
      return 'Haggler Plus';
    case 'RUSH_FEE':
      return 'Rush fee';
    case 'BOOSTED_LISTING':
      return 'Boosted listing';
    default:
      return 'Order';
  }
}
