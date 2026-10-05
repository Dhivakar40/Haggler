-- Phase 12 (D-077): client league system, plus a retrofit of Part D's own idempotency gap.
-- Prisma's diff engine can't see indexes on Unsupported("geography(...)") columns, so it always
-- proposes dropping addresses_location_gist / job_locations_location_gist /
-- service_requests_location_gist / worker_profiles_last_location_gist / payment_orders_status_idx
-- on every migration that touches an unrelated table. Stripped here, same as every prior phase's
-- migration — none of those 5 indexes are touched by this change.

-- CreateEnum
CREATE TYPE "client_league_tier" AS ENUM ('NEWCOMER', 'REGULAR', 'PREFERRED', 'TRUSTED', 'LOYAL', 'ELITE', 'CHAMPION', 'PATRON', 'LEGEND');

-- AlterTable: Part D idempotency retrofit. Backfilled to each Ranger's CURRENT league, the best
-- available approximation of "highest reached so far" without reconstructing wallet-ledger
-- history — safe in practice since this app has no real production Rangers yet.
ALTER TABLE "worker_stats" ADD COLUMN "highest_league" "league_tier" NOT NULL DEFAULT 'WOOD';
UPDATE "worker_stats" SET "highest_league" = "league";

-- AlterTable
ALTER TABLE "customer_stats"
  ADD COLUMN "bookings_completed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bookings_cancelled_by_customer" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "league" "client_league_tier" NOT NULL DEFAULT 'NEWCOMER',
  ADD COLUMN "highest_league" "client_league_tier" NOT NULL DEFAULT 'NEWCOMER';
