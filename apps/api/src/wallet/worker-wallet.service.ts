import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { conflict, unprocessable } from '../common/http-errors';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/**
 * Phase Commerce B3/B4/B6: the Ranger-side wallet — pay-after's mirror of the customer-side
 * CustomerWallet (tokens). `balancePaise` is withdrawable online-job earnings (the platform fee
 * already deducted before crediting, since an online payment is captured by the platform first).
 * `duesPaise` is platform fee owed from CASH jobs, where the Ranger collected the full amount
 * including the fee and still owes it to the platform. Never the other way around — a Ranger is
 * never charged for the service price itself (B: "Rangers keep 100% of the listed service price").
 */
@Injectable()
export class WorkerWalletService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate(tx: Tx, userId: string) {
    const existing = await tx.workerWallet.findUnique({ where: { userId } });
    if (existing) return existing;
    // Same race-safe pattern as CustomerWallet.getOrCreate: let the unique constraint pick a winner.
    try {
      return await tx.workerWallet.create({ data: { userId } });
    } catch {
      return tx.workerWallet.findUniqueOrThrow({ where: { userId } });
    }
  }

  async summary(userId: string) {
    const wallet = await this.prisma.workerWallet.findUnique({ where: { userId } });
    const ledger = wallet
      ? await this.prisma.workerWalletLedgerEntry.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];
    return {
      balancePaise: wallet?.balancePaise ?? 0,
      duesPaise: wallet?.duesPaise ?? 0,
      recentLedger: ledger.map((l) => ({
        id: l.id,
        type: l.type,
        amountPaise: l.amountPaise,
        jobId: l.jobId,
        note: l.note,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  /** An ONLINE job payment captured: credit the Ranger's withdrawable balance with the service
   * price (the fee was never theirs to begin with — the platform retains it at capture). */
  async creditEarning(tx: Tx, workerId: string, servicePricePaise: number, jobId: string) {
    const wallet = await this.getOrCreate(tx, workerId);
    await tx.workerWallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { increment: servicePricePaise } },
    });
    await tx.workerWalletLedgerEntry.create({
      data: { walletId: wallet.id, type: 'EARNING', amountPaise: servicePricePaise, jobId },
    });
  }

  /** A CASH job confirmed: the Ranger kept the full amount, including the fee, so the fee becomes
   * dues owed to the platform — regardless of whether the customer's confirmed amount matched
   * what the Ranger recorded (a mismatch is an admin-review flag on JobPayment, not a reason to
   * waive the fee). */
  async addDues(tx: Tx, workerId: string, feePaise: number, jobId: string) {
    const wallet = await this.getOrCreate(tx, workerId);
    await tx.workerWallet.update({
      where: { id: wallet.id },
      data: { duesPaise: { increment: feePaise } },
    });
    await tx.workerWalletLedgerEntry.create({
      data: { walletId: wallet.id, type: 'FEE_DUE', amountPaise: feePaise, jobId },
    });
  }

  /** B4: a Ranger whose dues are at/over the threshold can't take new jobs until settled. */
  async duesBlocked(workerId: string, thresholdPaise: number): Promise<boolean> {
    const wallet = await this.prisma.workerWallet.findUnique({ where: { userId: workerId } });
    return (wallet?.duesPaise ?? 0) >= thresholdPaise;
  }

  /** B4: settle dues directly from the withdrawable balance where possible, the rest is a
   * sandbox-simulated UPI payment (no real gateway call — same spirit as SandboxPaymentsProvider,
   * there is no live payout rail wired up yet). */
  async settleDues(userId: string, amountPaise: number) {
    const wallet = await this.prisma.workerWallet.findUnique({ where: { userId } });
    if (!wallet || wallet.duesPaise <= 0)
      throw conflict('No dues to settle.', { code: 'NO_DUES' });
    const amount = Math.min(amountPaise, wallet.duesPaise);
    await this.prisma.$transaction(async (tx) => {
      await tx.workerWallet.update({
        where: { id: wallet.id },
        data: { duesPaise: { decrement: amount } },
      });
      await tx.workerWalletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'DUES_SETTLED',
          amountPaise: -amount,
          note: 'Sandbox UPI settlement',
        },
      });
    });
    return { settledPaise: amount };
  }

  /** B6: sandbox withdrawal — instant and simulated, same caveat as settleDues. A real payout
   * rail and an admin-approval queue are not built; this just moves the money in the ledger. */
  async withdraw(userId: string, amountPaise: number) {
    const wallet = await this.prisma.workerWallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balancePaise < amountPaise)
      throw unprocessable('Not enough balance to withdraw that amount.', {
        code: 'INSUFFICIENT_BALANCE',
      });
    await this.prisma.$transaction(async (tx) => {
      await tx.workerWallet.update({
        where: { id: wallet.id },
        data: { balancePaise: { decrement: amountPaise } },
      });
      await tx.workerWalletLedgerEntry.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAWAL',
          amountPaise: -amountPaise,
          note: 'Sandbox payout (no admin-approval workflow yet)',
        },
      });
    });
    return { withdrawnPaise: amountPaise };
  }
}
