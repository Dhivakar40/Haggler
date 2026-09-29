-- NOTE: `prisma migrate diff` again wants to drop addresses_location_gist,
-- job_locations_location_gist, service_requests_location_gist, worker_profiles_last_location_gist
-- (raw-SQL indexes on Unsupported geography columns, invisible to Prisma's diff) and
-- payment_orders_status_idx (a raw-SQL index from an earlier migration). None of those are
-- dropped here — see the same note in 20260930000002_phase3_wallet_payments/migration.sql.

-- AlterTable
ALTER TABLE "worker_stats" ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating_sum" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_stats" (
    "customer_user_id" UUID NOT NULL,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_stats_pkey" PRIMARY KEY ("customer_user_id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "rater_id" UUID NOT NULL,
    "reviewee_id" UUID NOT NULL,
    "rater_role" "party_role" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_reviewee_id_created_at_idx" ON "reviews"("reviewee_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_job_id_rater_role_key" ON "reviews"("job_id", "rater_role");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rating is always 1-5; the application never sends anything else, but this is the last line
-- of defence if that check is ever bypassed or buggy (same reasoning as the wallet CHECKs).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "worker_stats" ADD CONSTRAINT "worker_stats_rating_sum_nonneg" CHECK ("rating_sum" >= 0);
ALTER TABLE "worker_stats" ADD CONSTRAINT "worker_stats_rating_count_nonneg" CHECK ("rating_count" >= 0);
ALTER TABLE "customer_stats" ADD CONSTRAINT "customer_stats_rating_sum_nonneg" CHECK ("rating_sum" >= 0);
ALTER TABLE "customer_stats" ADD CONSTRAINT "customer_stats_rating_count_nonneg" CHECK ("rating_count" >= 0);
