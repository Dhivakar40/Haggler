-- Phase 14 (D-080, Sub-phase A3/A4): negotiation removed for ordinary bookings, replaced by the
-- request's frozen fixed-list price; "other" keeps its own per-Ranger quote table (no counters).
-- Additive only: three new nullable/defaulted columns on service_requests, one new table, one new
-- enum. "offers" is untouched — no new negotiation row is ever created after this migration, but
-- every historical one stays exactly as it was.

-- CreateEnum
CREATE TYPE "job_quote_status" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "service_requests"
  ADD COLUMN "listed_price_paise" INTEGER,
  ADD COLUMN "listed_price_city_tier" "city_tier",
  ADD COLUMN "is_inspection_charge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "job_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" "job_quote_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_quotes_job_id_worker_id_key" ON "job_quotes"("job_id", "worker_id");

-- CreateIndex
CREATE INDEX "job_quotes_job_id_status_idx" ON "job_quotes"("job_id", "status");

-- AddForeignKey
ALTER TABLE "job_quotes" ADD CONSTRAINT "job_quotes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
