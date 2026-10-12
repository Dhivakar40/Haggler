-- D-093 (Sub-phase J): additive only. A new UserStatus value and a nullable timestamp column.
-- No columns dropped, no data modified.

ALTER TYPE "user_status" ADD VALUE 'TEMPORARY_HOLD';
ALTER TABLE "users" ADD COLUMN "hold_started_at" TIMESTAMPTZ(6);
