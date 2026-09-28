import 'reflect-metadata';
import { PrismaClient, type AdminRoleType } from '@prisma/client';
import { hashPassword } from '../src/common/crypto';

/**
 * Creates (or updates the password/roles of) an admin account.
 *
 *   ADMIN_PASSWORD='a-long-passphrase' pnpm --filter @haggler/api admin:create \
 *       --email reviewer@example.com --name "Asha R" --roles KYC_REVIEWER
 *
 * The password comes from the environment, not argv, so it does not land in shell history or `ps`.
 */
const ROLES: AdminRoleType[] = ['KYC_REVIEWER', 'DISPUTE_AGENT', 'FINANCE', 'SUPER_ADMIN'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name');
  const roles = (arg('roles') ?? 'KYC_REVIEWER').split(',').map((r) => r.trim()) as AdminRoleType[];
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !name) throw new Error('Usage: --email <email> --name <full name> [--roles A,B]');
  if (!password || password.length < 12)
    throw new Error('Set ADMIN_PASSWORD (at least 12 characters)');
  for (const r of roles)
    if (!ROLES.includes(r)) throw new Error(`Unknown role ${r}. Valid: ${ROLES.join(', ')}`);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    const admin = await prisma.adminUser.upsert({
      where: { email },
      update: { passwordHash, fullName: name, isActive: true },
      create: { email, passwordHash, fullName: name },
    });
    await prisma.adminRole.deleteMany({ where: { adminUserId: admin.id } });
    await prisma.adminRole.createMany({
      data: roles.map((role) => ({ adminUserId: admin.id, role })),
    });
    await prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: 'admin.upserted',
        entityType: 'admin_user',
        entityId: admin.id,
        after: { roles },
      },
    });
    console.log(`Admin ready: ${email} [${roles.join(', ')}]`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
