-- CreateEnum
CREATE TYPE "ContractPayType" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ContractListingStatus" AS ENUM ('OPEN', 'PAUSED', 'FILLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractApplicationStatus" AS ENUM ('APPLIED', 'SHORTLISTED', 'REJECTED', 'HIRED', 'WITHDRAWN');

-- Prisma's migrate-diff engine cannot see indexes on Unsupported("geography(...)") columns or
-- raw-SQL-created indexes from earlier migrations, so it always proposes dropping
-- addresses_location_gist, job_locations_location_gist, service_requests_location_gist,
-- worker_profiles_last_location_gist and payment_orders_status_idx whenever an unrelated schema
-- change is diffed. None of those indexes are touched by this migration; the spurious DROP INDEX
-- statements were removed by hand (see docs/DECISIONS.md and every migration since Phase 2).

-- CreateTable
CREATE TABLE "employer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pay_type" "ContractPayType" NOT NULL,
    "pay_amount_paise" INTEGER NOT NULL,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "filled_count" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "start_date" DATE,
    "status" "ContractListingStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "cover_note" TEXT,
    "status" "ContractApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employer_profiles_user_id_key" ON "employer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "contract_listings_status_category_id_created_at_idx" ON "contract_listings"("status", "category_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contract_listings_employer_id_created_at_idx" ON "contract_listings"("employer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contract_applications_worker_id_applied_at_idx" ON "contract_applications"("worker_id", "applied_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contract_applications_listing_id_worker_id_key" ON "contract_applications"("listing_id", "worker_id");

-- AddForeignKey
ALTER TABLE "employer_profiles" ADD CONSTRAINT "employer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_listings" ADD CONSTRAINT "contract_listings_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_listings" ADD CONSTRAINT "contract_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_applications" ADD CONSTRAINT "contract_applications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "contract_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_applications" ADD CONSTRAINT "contract_applications_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
