-- Phase Commerce B2/B3/B4/B6: the platform fee and pay-after payment recording. Additive only —
-- two new nullable columns, three new tables, two new enums, one new PaymentPurpose value. The
-- token system (customer_wallets, wallet_holds, token_bundles, WalletService.hold/consume/
-- release) is untouched in this migration; it stops being called from application code in the
-- same commit, per the same "keep history readable, stop writing new rows" pattern as D-080's
-- negotiation removal.

-- AlterEnum (additive: a new value on an existing enum)
ALTER TYPE "payment_purpose" ADD VALUE 'JOB_PAYMENT';

-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN "fee_bps" INTEGER;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "platform_fee_paise" INTEGER;

-- CreateEnum
CREATE TYPE "worker_wallet_ledger_type" AS ENUM ('EARNING', 'FEE_DUE', 'DUES_SETTLED', 'WITHDRAWAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "job_payment_mode" AS ENUM ('CASH', 'ONLINE');

-- CreateEnum
CREATE TYPE "job_payment_status" AS ENUM ('PENDING', 'CONFIRMED', 'MISMATCHED');

-- CreateTable
CREATE TABLE "worker_wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "balance_paise" INTEGER NOT NULL DEFAULT 0,
    "dues_paise" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_wallet_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "type" "worker_wallet_ledger_type" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "job_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "mode" "job_payment_mode" NOT NULL,
    "service_price_paise" INTEGER NOT NULL,
    "fee_paise" INTEGER NOT NULL,
    "total_paise" INTEGER NOT NULL,
    "cash_recorded_paise" INTEGER,
    "cash_confirmed_paise" INTEGER,
    "status" "job_payment_status" NOT NULL DEFAULT 'PENDING',
    "payment_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_wallets_user_id_key" ON "worker_wallets"("user_id");

-- CreateIndex
CREATE INDEX "worker_wallet_ledger_entries_wallet_id_created_at_idx" ON "worker_wallet_ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_payments_job_id_key" ON "job_payments"("job_id");

-- AddForeignKey
ALTER TABLE "worker_wallet_ledger_entries" ADD CONSTRAINT "worker_wallet_ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "worker_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_payments" ADD CONSTRAINT "job_payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- worker_wallet_ledger_entries is append-only, same pattern as wallet_ledger_entries (D-011/D-030).
CREATE FUNCTION worker_wallet_ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'worker_wallet_ledger_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER worker_wallet_ledger_entries_no_update_delete
  BEFORE UPDATE ON "worker_wallet_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION worker_wallet_ledger_entries_immutable();
