-- Phase 13 (D-080, Sub-phase A1/A2/A5): admin-managed fixed price list, replacing negotiation
-- for ordinary bookings, plus the inspection-charge flag for uncertain-scope categories and the
-- mid-job add-on approval flow. Additive only: new enums, one new nullable column, three new
-- tables. Nothing existing is dropped, renamed or rewritten — "offers" and "price_bands" are
-- untouched and stay fully readable.

-- CreateEnum
CREATE TYPE "city_tier" AS ENUM ('TIER_1', 'TIER_2', 'DEFAULT');

-- CreateEnum
CREATE TYPE "job_add_on_status" AS ENUM ('PROPOSED', 'APPROVED', 'DECLINED');

-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN "inspection_charge_paise" INTEGER;

-- CreateTable
CREATE TABLE "price_list_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "city_tier" "city_tier" NOT NULL DEFAULT 'DEFAULT',
    "price_paise" INTEGER NOT NULL,
    "needs_survey" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "price_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_add_ons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "price_list_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_add_ons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "add_on_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "status" "job_add_on_status" NOT NULL DEFAULT 'PROPOSED',
    "proposed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_list_entries_category_id_city_tier_key" ON "price_list_entries"("category_id", "city_tier");

-- CreateIndex
CREATE INDEX "job_add_ons_job_id_idx" ON "job_add_ons"("job_id");

-- AddForeignKey
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_add_ons" ADD CONSTRAINT "price_list_add_ons_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_add_ons" ADD CONSTRAINT "job_add_ons_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_add_ons" ADD CONSTRAINT "job_add_ons_add_on_id_fkey" FOREIGN KEY ("add_on_id") REFERENCES "price_list_add_ons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
