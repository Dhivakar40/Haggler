-- Prisma's migrate-diff engine cannot see indexes on Unsupported("geography(...)") columns or
-- raw-SQL-created indexes from earlier migrations, so it always proposes dropping
-- addresses_location_gist, job_locations_location_gist, service_requests_location_gist,
-- worker_profiles_last_location_gist and payment_orders_status_idx whenever an unrelated schema
-- change is diffed. None of those indexes are touched by this migration; the spurious DROP INDEX
-- statements were removed by hand (see docs/DECISIONS.md and every migration since Phase 2).

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "hidden_at" TIMESTAMPTZ(6),
ADD COLUMN     "hidden_reason" TEXT;
