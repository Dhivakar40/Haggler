import { PrismaClient } from '@prisma/client';

/**
 * Idempotent seed: safe to run repeatedly (upserts). Seeds ONLY reference data.
 *
 * The DEFAULT price bands are placeholders so the app has something to show before any job
 * has completed. They are labelled `sample_size = 0` and the API reports
 * `isSeededDefault: true`. Ops must review them before launch (docs/COMPLIANCE.md checklist
 * is for legal; docs/RUNBOOK.md lists this one). Rupee amounts below are in PAISE.
 *
 * minimum_wage_rules is deliberately NOT seeded: legal counsel must supply those numbers.
 */
const prisma = new PrismaClient();

const rupees = (n: number) => n * 100;

const CATEGORIES = [
  { slug: 'electrician', icon: 'flash', requiresLicense: false, band: [199, 349, 699] },
  { slug: 'plumber', icon: 'water', requiresLicense: false, band: [199, 349, 699] },
  { slug: 'cleaner', icon: 'sparkles', requiresLicense: false, band: [299, 499, 999] },
  { slug: 'carpenter', icon: 'hammer', requiresLicense: false, band: [299, 499, 999] },
  { slug: 'appliance_repair', icon: 'construct', requiresLicense: false, band: [249, 399, 799] },
  { slug: 'ac_repair', icon: 'snow', requiresLicense: false, band: [349, 599, 1199] },
  { slug: 'painter', icon: 'color-palette', requiresLicense: false, band: [499, 899, 1999] },
  { slug: 'pest_control', icon: 'bug', requiresLicense: false, band: [399, 699, 1499] },
  { slug: 'gas_appliance_repair', icon: 'flame', requiresLicense: true, band: [299, 499, 999] },
] as const;

const SYSTEM_CONFIG: { key: string; value: unknown; description: string }[] = [
  {
    key: 'price_band_min_sample',
    value: 10,
    description: 'Min completed jobs before a computed price band is trusted',
  },
  {
    key: 'price_band_window_jobs',
    value: 50,
    description: 'Median is taken over the last N completed jobs',
  },
  {
    key: 'commission_bps',
    value: 600,
    description: 'Platform commission in basis points (600 = 6%)',
  },
  {
    key: 'broadcast_radii_m',
    value: [2000, 5000, 10000],
    description: 'Matching radius waves in metres',
  },
  { key: 'otp_ttl_seconds', value: 300, description: 'Phone OTP validity' },
  {
    key: 'kyc_image_retention_days',
    value: 30,
    description: 'Days after a KYC decision before identity images are deleted',
  },
  {
    key: 'student_weekly_hour_cap',
    value: 20,
    description: 'Max part-time hours per week for students',
  },
  {
    key: 'tier_bonus_monthly_budget_paise',
    value: 0,
    description: 'Monthly cap on badge-promotion bonuses. 0 until finance sets it',
  },
  {
    key: 'damage_coverage_cap_paise',
    value: 0,
    description: 'Damage claim coverage cap. 0 until an insurer/policy is confirmed',
  },
];

const FEATURE_FLAGS = [
  { key: 'contracts_enabled', description: 'Haggler Contracts marketplace' },
  { key: 'campus_enabled', description: 'Haggler Campus student jobs' },
  { key: 'escrow_enabled', description: 'In-app UPI escrow' },
  { key: 'promoted_listings_enabled', description: 'Promoted placement for Rangers' },
];

// Customer-only token bundles (Phase 3, D-037): Rangers are never charged. One token is spent
// only when a job is confirmed complete. Prices are placeholders for ops/finance to review, same
// as the DEFAULT price bands above.
const TOKEN_BUNDLES = [
  { slug: 'starter-3', name: '3 tokens', tokens: 3, priceRupees: 49 },
  { slug: 'value-10', name: '10 tokens', tokens: 10, priceRupees: 149 },
  { slug: 'saver-25', name: '25 tokens', tokens: 25, priceRupees: 329 },
];

async function main(): Promise<void> {
  let order = 0;
  for (const c of CATEGORIES) {
    order += 10;
    const category = await prisma.serviceCategory.upsert({
      where: { slug: c.slug },
      update: { icon: c.icon, requiresLicense: c.requiresLicense, sortOrder: order },
      create: {
        slug: c.slug,
        nameKey: `categories.${c.slug}`,
        icon: c.icon,
        requiresLicense: c.requiresLicense,
        sortOrder: order,
      },
    });

    const [min, median, max] = c.band;
    const existing = await prisma.priceBand.findFirst({
      where: { categoryId: category.id, scope: 'DEFAULT' },
    });
    const data = { minPaise: rupees(min), medianPaise: rupees(median), maxPaise: rupees(max) };
    if (existing) {
      await prisma.priceBand.update({ where: { id: existing.id }, data });
    } else {
      await prisma.priceBand.create({
        data: { categoryId: category.id, scope: 'DEFAULT', sampleSize: 0, ...data },
      });
    }
  }

  for (const cfg of SYSTEM_CONFIG) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      // Never overwrite a value an admin has changed; only set it when missing.
      update: { description: cfg.description },
      create: { key: cfg.key, value: cfg.value as never, description: cfg.description },
    });
  }

  for (const f of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: f.key },
      update: { description: f.description },
      create: { key: f.key, enabled: false, description: f.description },
    });
  }

  let bundleOrder = 0;
  for (const b of TOKEN_BUNDLES) {
    bundleOrder += 10;
    await prisma.tokenBundle.upsert({
      where: { slug: b.slug },
      // Never overwrite pricing/tokens an admin has since changed; only set what's missing.
      update: { name: b.name, sortOrder: bundleOrder },
      create: {
        slug: b.slug,
        name: b.name,
        tokens: b.tokens,
        pricePaise: rupees(b.priceRupees),
        sortOrder: bundleOrder,
      },
    });
  }

  const [cats, bands, bundles] = await Promise.all([
    prisma.serviceCategory.count(),
    prisma.priceBand.count(),
    prisma.tokenBundle.count(),
  ]);
  console.log(`Seed complete: ${cats} categories, ${bands} price bands, ${bundles} token bundles`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
