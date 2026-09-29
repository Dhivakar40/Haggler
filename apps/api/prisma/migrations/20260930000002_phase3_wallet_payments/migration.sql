-- CreateEnum
CREATE TYPE "wallet_ledger_type" AS ENUM ('PURCHASE', 'HOLD', 'RELEASE', 'CONSUME', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "wallet_hold_status" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "payment_order_status" AS ENUM ('CREATED', 'PAID', 'FAILED', 'CANCELLED');

-- NOTE: `prisma migrate diff` wants to drop addresses_location_gist, job_locations_location_gist,
-- service_requests_location_gist and worker_profiles_last_location_gist here. Those indexes are on
-- Unsupported("geography(...)") columns, created by raw SQL in earlier migrations (Prisma cannot
-- see indexes on Unsupported columns), and must NOT be dropped. Removed from this migration.

-- CreateTable
CREATE TABLE "customer_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "balance_tokens" INTEGER NOT NULL DEFAULT 0,
    "held_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "type" "wallet_ledger_type" NOT NULL,
    "tokens_delta" INTEGER NOT NULL,
    "job_id" UUID,
    "payment_order_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 1,
    "status" "wallet_hold_status" NOT NULL DEFAULT 'HELD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallet_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_bundles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "token_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "bundle_id" UUID NOT NULL,
    "tokens" INTEGER NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "status" "payment_order_status" NOT NULL DEFAULT 'CREATED',
    "paid_at" TIMESTAMPTZ(6),
    "failed_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_wallets_user_id_key" ON "customer_wallets"("user_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_wallet_id_created_at_idx" ON "wallet_ledger_entries"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_job_id_idx" ON "wallet_ledger_entries"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_holds_job_id_key" ON "wallet_holds"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_bundles_slug_key" ON "token_bundles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_provider_payment_id_key" ON "payment_orders"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_provider_provider_order_id_key" ON "payment_orders"("provider", "provider_order_id");

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "customer_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "customer_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "token_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A wallet can never go negative and can never hold more than it has: these are the last line of
-- defence if WalletService's application-level checks are ever bypassed or buggy.
ALTER TABLE "customer_wallets" ADD CONSTRAINT "customer_wallets_balance_nonneg" CHECK ("balance_tokens" >= 0);
ALTER TABLE "customer_wallets" ADD CONSTRAINT "customer_wallets_held_nonneg" CHECK ("held_tokens" >= 0);
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_tokens_positive" CHECK ("tokens" > 0);
ALTER TABLE "token_bundles" ADD CONSTRAINT "token_bundles_tokens_positive" CHECK ("tokens" > 0);
ALTER TABLE "token_bundles" ADD CONSTRAINT "token_bundles_price_positive" CHECK ("price_paise" > 0);
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tokens_positive" CHECK ("tokens" > 0);
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_amount_positive" CHECK ("amount_paise" > 0);

-- wallet_ledger_entries is append-only, exactly like job_events (D-011/D-030 pattern).
CREATE FUNCTION wallet_ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_ledger_entries_no_update_delete
  BEFORE UPDATE ON "wallet_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_entries_immutable();

-- Fast lookup for the webhook/verify race: "has this provider order already been paid?"
CREATE INDEX "payment_orders_status_idx" ON "payment_orders"("status");
