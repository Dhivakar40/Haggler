-- Phase Flow-Final (D-087): the schema foundation for Sub-phases G-J. Additive — new enum
-- values, new columns, new tables. The one non-pure-additive piece is the two paragraphs at the
-- bottom: the double-booking unique index and the matched-needs-worker CHECK constraint are
-- dropped and recreated with the new statuses added to their lists. No data is touched by
-- either — both are metadata-level constraints, not columns or rows — but noted here because
-- "additive only" is usually read as "never DROP anything", and this is the one place this
-- migration drops something (a constraint definition, not data).

-- AlterEnum (additive: new values on existing enums). Each ADD VALUE is its own statement and
-- none of them is referenced elsewhere in this same migration — the same "don't use a new enum
-- value in the transaction that added it" rule D-081/D-083 already followed.
ALTER TYPE "job_status" ADD VALUE 'QUOTING';
ALTER TYPE "job_status" ADD VALUE 'QUOTE_REJECTED';
ALTER TYPE "job_status" ADD VALUE 'PAUSED_PARTS';
ALTER TYPE "job_photo_kind" ADD VALUE 'SELFIE';
ALTER TYPE "dispute_resolution" ADD VALUE 'CUSTOMER_SUSPENDED';

-- CreateEnum
CREATE TYPE "quote_item_kind" AS ENUM ('LABOUR', 'PART', 'EXTRA');

-- CreateEnum
CREATE TYPE "incident_report_reason" AS ENUM ('THEFT', 'DAMAGE', 'HARASSMENT', 'DISCRIMINATION', 'ACCIDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "incident_report_status" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED');

-- AlterTable: jobs — completion OTP (mirrors the existing arrival code), pause/extension
-- bookkeeping, visit-fee freeze, and a free-form settlement tag.
ALTER TABLE "jobs"
  ADD COLUMN "completion_code_hash" TEXT,
  ADD COLUMN "completion_code_enc" TEXT,
  ADD COLUMN "completion_code_tries" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completion_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "paid_pending_code_at" TIMESTAMPTZ(6),
  ADD COLUMN "accepted_quote_id" UUID,
  ADD COLUMN "paused_at" TIMESTAMPTZ(6),
  ADD COLUMN "paused_reason" TEXT,
  ADD COLUMN "paused_extension_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paused_return_by" TIMESTAMPTZ(6),
  ADD COLUMN "visit_fee_paise" INTEGER,
  ADD COLUMN "visit_fee_charged_at" TIMESTAMPTZ(6),
  ADD COLUMN "close_reason" TEXT;

-- AlterTable: service_categories — per-category ceiling-multiple override.
ALTER TABLE "service_categories" ADD COLUMN "ceiling_multiple_bps" INTEGER;

-- AlterTable: price_list_add_ons — this catalogue is now also the labour-item list a quote is
-- built from; price_paise becomes that item's floor, and this is the per-item ceiling override.
ALTER TABLE "price_list_add_ons" ADD COLUMN "ceiling_multiple_bps" INTEGER;

-- AlterTable: job_quotes — line-itemised totals, the above-ceiling flag + evidence, and the
-- admin-review flag. amount_paise (the old single-number quote, still used by "other") is
-- untouched.
ALTER TABLE "job_quotes"
  ADD COLUMN "service_paise" INTEGER,
  ADD COLUMN "parts_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extra_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extra_description" TEXT,
  ADD COLUMN "fee_paise" INTEGER,
  ADD COLUMN "total_paise" INTEGER,
  ADD COLUMN "above_ceiling" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "above_ceiling_photo_id" UUID,
  ADD COLUMN "above_ceiling_reason" TEXT,
  ADD COLUMN "flagged_for_review" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: job_quote_items
CREATE TABLE "job_quote_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "kind" "quote_item_kind" NOT NULL,
    "catalog_item_id" UUID,
    "name" TEXT NOT NULL,
    "unit_price_paise" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "total_paise" INTEGER NOT NULL,
    "bill_photo_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_quote_items_quote_id_idx" ON "job_quote_items"("quote_id");

-- AddForeignKey
ALTER TABLE "job_quote_items" ADD CONSTRAINT "job_quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "job_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: incident_reports
CREATE TABLE "incident_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reporter_role" "party_role" NOT NULL,
    "reason" "incident_report_reason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "incident_report_status" NOT NULL DEFAULT 'OPEN',
    "suspended_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "incident_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_reports_job_id_idx" ON "incident_reports"("job_id");

-- CreateIndex
CREATE INDEX "incident_reports_status_created_at_idx" ON "incident_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: worker_profiles — a keyed hash of the strongest identifier already collected
-- (Aadhaar, hashed at KYC approval, plaintext discarded), and a reliability score.
ALTER TABLE "worker_profiles"
  ADD COLUMN "identity_hash" TEXT,
  ADD COLUMN "reliability_score" DOUBLE PRECISION NOT NULL DEFAULT 100;

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_identity_hash_key" ON "worker_profiles"("identity_hash");

-- AlterTable: customer_wallets — the token->promo-credit migration target (H7). Nothing writes
-- to it yet; see admin-token-migration.service.ts.
ALTER TABLE "customer_wallets" ADD COLUMN "promo_credit_paise" INTEGER NOT NULL DEFAULT 0;

-- Constraint updates: add the new active-ish statuses to the double-booking guard and the
-- matched-needs-worker check (see the file header for why this is safe).
DROP INDEX "jobs_one_active_per_worker";
CREATE UNIQUE INDEX "jobs_one_active_per_worker"
  ON "jobs" ("worker_id")
  WHERE "worker_id" IS NOT NULL
    AND "status" IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'QUOTING', 'PAUSED_PARTS');

ALTER TABLE "jobs" DROP CONSTRAINT "jobs_matched_needs_worker";
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_matched_needs_worker" CHECK (
  "status" NOT IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
                   'COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'QUOTING', 'PAUSED_PARTS', 'QUOTE_REJECTED')
  OR "worker_id" IS NOT NULL
);
