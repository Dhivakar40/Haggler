-- CreateEnum
CREATE TYPE "payment_purpose" AS ENUM ('TOKEN_TOPUP', 'PLUS_SUBSCRIPTION', 'RUSH_FEE', 'BOOSTED_LISTING');

-- CreateEnum
CREATE TYPE "listing_kind" AS ENUM ('CONTRACT', 'CAMPUS');

-- CreateEnum
CREATE TYPE "plus_audience" AS ENUM ('CUSTOMER', 'EMPLOYER');

-- Prisma's diff engine can't see indexes on Unsupported("geography(...)") columns, so it always
-- proposes dropping addresses_location_gist / job_locations_location_gist /
-- service_requests_location_gist / worker_profiles_last_location_gist / payment_orders_status_idx
-- on every migration that touches an unrelated table. Stripped here, same as every prior phase's
-- migration — none of those 5 indexes are touched by this change.

-- DropForeignKey
ALTER TABLE "payment_orders" DROP CONSTRAINT "payment_orders_bundle_id_fkey";

-- AlterTable
ALTER TABLE "campus_listings" ADD COLUMN     "boosted_until" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "contract_listings" ADD COLUMN     "boosted_until" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "is_rush" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "plan_id" UUID,
ADD COLUMN     "purpose" "payment_purpose" NOT NULL DEFAULT 'TOKEN_TOPUP',
ADD COLUMN     "target_job_id" UUID,
ADD COLUMN     "target_listing_id" UUID,
ADD COLUMN     "target_listing_type" "listing_kind",
ALTER COLUMN "bundle_id" DROP NOT NULL,
ALTER COLUMN "tokens" DROP NOT NULL;

-- CreateTable
CREATE TABLE "plus_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audience" "plus_audience" NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "token_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plus_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plus_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plus_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plus_plans_slug_key" ON "plus_plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plus_memberships_user_id_key" ON "plus_memberships"("user_id");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "token_bundles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plus_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plus_memberships" ADD CONSTRAINT "plus_memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plus_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
