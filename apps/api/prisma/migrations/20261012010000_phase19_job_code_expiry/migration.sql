-- D-091: additive only. Adds expiry timestamps for the job start/completion codes (previously
-- never expired); existing rows get NULL, which the application treats as "generated before
-- this migration, do not retroactively expire." No columns dropped, no data modified.

ALTER TABLE "jobs" ADD COLUMN "arrival_code_expires_at" TIMESTAMPTZ(6);
ALTER TABLE "jobs" ADD COLUMN "completion_code_expires_at" TIMESTAMPTZ(6);
