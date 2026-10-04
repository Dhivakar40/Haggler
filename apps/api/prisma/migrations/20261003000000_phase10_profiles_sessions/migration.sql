-- Phase 10 (D-075): mandatory profile setup + "keep me logged in".
-- Prisma's diff engine can't see indexes on Unsupported("geography(...)") columns, so it always
-- proposes dropping addresses_location_gist / job_locations_location_gist /
-- service_requests_location_gist / worker_profiles_last_location_gist / payment_orders_status_idx
-- on every migration that touches an unrelated table. Stripped here, same as every prior phase's
-- migration — none of those 5 indexes are touched by this change.

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "date_of_birth_enc" TEXT,
  ADD COLUMN "gender" "gender",
  ADD COLUMN "profile_completed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "refresh_tokens"
  ADD COLUMN "remember_me" BOOLEAN NOT NULL DEFAULT false;
