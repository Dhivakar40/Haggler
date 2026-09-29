-- NOTE: `prisma migrate diff` also wants to drop addresses_location_gist, job_locations_location_gist,
-- service_requests_location_gist, worker_profiles_last_location_gist (raw-SQL indexes on
-- Unsupported geography columns, invisible to Prisma's diff) AND payment_orders_status_idx (a
-- raw-SQL index from the previous migration). None of those are dropped here.

-- AlterTable
ALTER TABLE "wallet_ledger_entries" ADD COLUMN     "held_delta" INTEGER NOT NULL DEFAULT 0;
