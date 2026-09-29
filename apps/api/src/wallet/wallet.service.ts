import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { decodeCursor, toPage } from '@haggler/shared';
import { PAYMENTS_PROVIDER, type PaymentsProvider } from '../adapters/payments/payments.provider';
import { conflict, forbidden, notFound, unprocessable } from '../common/http-errors';
import { EnvService } from '../config/env.service';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * The customer token wallet (Phase 3, D-037/D-038/D-039). Rangers are never charged: this service
 * only ever moves TOKENS a customer bought, and only against the CUSTOMER's own wallet.
 *
 * Bookkeeping, always kept consistent in one transaction:
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

  async listBundles() {
    const rows = await this.prisma.tokenBundle.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      tokens: b.tokens,
      pricePaise: b.pricePaise,
    }));
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
      include: { bundle: { select: { name: true } } },
    });
    const page = toPage(rows, limit, (r) => ({ k: r.createdAt.toISOString(), id: r.id }));
    return {
      items: page.items.map((o) => ({
        id: o.id,
        bundleName: o.bundle.name,
        tokens: o.tokens,
        amountPaise: o.amountPaise,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ---- top-up: create an order, then verify it (client callback or webhook) -----------------

  async createTopupOrder(userId: string, bundleId: string) {
    const bundle = await this.prisma.tokenBundle.findFirst({
      where: { id: bundleId, isActive: true },
    });
    if (!bundle) throw notFound('That token bundle is not available.');
    const receipt = `topup:${userId}:${randomUUID()}`;
    const created = await this.payments.createOrder(bundle.pricePaise, receipt);
    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        bundleId: bundle.id,
        tokens: bundle.tokens,
        amountPaise: bundle.pricePaise,
        provider: this.payments.mode,
        providerOrderId: created.providerOrderId,
      },
    });
    return {
      orderId: order.id,
      provider: this.payments.mode,
      providerOrderId: order.providerOrderId,
      amountPaise: order.amountPaise,
      tokens: order.tokens,
      keyId: this.payments.publicKeyId,
    };
  }

  /** Client-side verification path: the Razorpay Checkout success callback (or the sandbox screen). */
  async verifyTopup(userId: string, orderId: string, paymentId: string, signature: string) {
    const order = await this.prisma.paymentOrder.findFirst({ where: { id: orderId, userId } });
    if (!order) throw notFound('Order not found');
    if (order.status === 'PAID') return this.summary(userId); // idempotent: webhook may have won the race
    if (order.status !== 'CREATED')
      throw conflict('This order can no longer be paid.', { code: 'ORDER_NOT_PAYABLE' });
    if (!this.payments.verifyPaymentSignature(order.providerOrderId, paymentId, signature))
      throw unprocessable('Payment could not be verified.', { code: 'SIGNATURE_INVALID' });
    await this.credit(order.id, order.providerOrderId, paymentId);
    return this.summary(userId);
  }

  /**
   * Dev/test convenience only, exactly like the sandbox SMS provider printing the OTP: there is no
   * real gateway to redirect to in sandbox mode, so the mobile app asks the API to sign a payment
   * id itself and immediately runs it through the SAME verification path as a real payment. Refused
   * outside PAYMENTS_MODE=sandbox.
   */
  async sandboxPay(userId: string, orderId: string) {
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
    return this.verifyTopup(userId, orderId, paymentId, signature);
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

  /** Race-safe credit: whichever of (client verify, webhook) arrives first wins; the other no-ops. */
  private async credit(orderId: string, providerOrderId: string, paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: 'CREATED' },
        data: { status: 'PAID', paidAt: new Date(), providerPaymentId: paymentId },
      });
      if (res.count !== 1) return; // someone else (webhook or a retried verify call) already credited it
      const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
      const wallet = await tx.customerWallet.upsert({
        where: { userId: order.userId },
        update: {},
        create: { userId: order.userId },
      });
      await tx.customerWallet.update({
        where: { id: wallet.id },
        data: { balanceTokens: { increment: order.tokens } },
      });
      await tx.walletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'PURCHASE',
          tokensDelta: order.tokens,
          heldDelta: 0,
          paymentOrderId: order.id,
          note: `${order.tokens} tokens via ${providerOrderId}`,
        },
      });
    });
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
}
