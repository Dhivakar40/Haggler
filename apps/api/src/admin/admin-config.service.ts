import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DEFAULT_FEE_SETTINGS, FEE_SETTINGS_KEYS, FeeService } from '../marketplace/fee.service';
import type { AuthAdmin } from '../common/decorators';
import { notFound, unprocessable } from '../common/http-errors';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** D-087: a generic editor for the Phase Commerce/Flow-Final tunables FeeService reads
 * (platform fee %, visit-fee bands, the quote ceiling multiple, cash_enabled, ...). Every one
 * of these was previously only editable by hand in the database — this is the first admin path
 * for any of them, closing a gap that predates this phase (platform_fee_bps itself had no
 * admin endpoint either). Allowlisted to FeeService's own keys, not arbitrary system_config
 * rows, so this can't be used to edit something it has no business touching. */
@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fee: FeeService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const cfg = await this.fee.get();
    return FEE_SETTINGS_KEYS.map((key) => ({
      key,
      value: cfg[key],
      default: DEFAULT_FEE_SETTINGS[key],
    }));
  }

  async set(key: string, value: unknown, admin: AuthAdmin): Promise<{ ok: true }> {
    if (!(FEE_SETTINGS_KEYS as readonly string[]).includes(key))
      throw notFound('No such config key');
    const def = (DEFAULT_FEE_SETTINGS as unknown as Record<string, unknown>)[key];
    const sameType = Array.isArray(def) ? Array.isArray(value) : typeof value === typeof def;
    if (!sameType)
      throw unprocessable(`${key} must be a ${Array.isArray(def) ? 'list' : typeof def}.`);

    const jsonValue = value as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.systemConfig.upsert({
        where: { key },
        update: { value: jsonValue },
        create: { key, value: jsonValue },
      });
      await this.audit.record(
        {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'system_config.set',
          entityType: 'system_config',
          entityId: key,
          after: { value: jsonValue },
        },
        tx,
      );
    });
    this.fee.refresh();
    return { ok: true };
  }
}
