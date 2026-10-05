-- Phase 11 (D-076): Ranger league system, replacing the flat badge-tier ladder.
-- Prisma's diff engine can't see indexes on Unsupported("geography(...)") columns, so it always
-- proposes dropping addresses_location_gist / job_locations_location_gist /
-- service_requests_location_gist / worker_profiles_last_location_gist / payment_orders_status_idx
-- on every migration that touches an unrelated table. Stripped here, same as every prior phase's
-- migration — none of those 5 indexes are touched by this change.

-- CreateEnum
CREATE TYPE "league_tier" AS ENUM ('WOOD', 'STONE', 'COPPER', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'LEGENDARY');

-- AlterEnum (wallet ledger)
ALTER TYPE "wallet_ledger_type" ADD VALUE 'BONUS';

-- AlterTable: rename badge_tier -> league, change its type, migrate existing data.
-- BRONZE/SILVER/GOLD/PLATINUM/DIAMOND share the same variant names in both enums, so this cast
-- carries every existing Ranger's standing across unchanged — no progress reset.
ALTER TABLE "worker_stats" RENAME COLUMN "badge_tier" TO "league";
ALTER TABLE "worker_stats"
  ALTER COLUMN "league" DROP DEFAULT,
  ALTER COLUMN "league" TYPE "league_tier" USING ("league"::text::"league_tier"),
  ALTER COLUMN "league" SET DEFAULT 'WOOD';

ALTER TABLE "worker_stats"
  ADD COLUMN "jobs_cancelled_by_worker" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "jobs_disputed" INTEGER NOT NULL DEFAULT 0;
