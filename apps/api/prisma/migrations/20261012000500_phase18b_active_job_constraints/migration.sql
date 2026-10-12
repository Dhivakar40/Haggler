-- D-087, split out of 20261012000000_phase18_flow_final_foundation (see that file's note):
-- Postgres refuses to use a new enum value in the same transaction that adds it, and this
-- rebuild uses QUOTING/PAUSED_PARTS/QUOTE_REJECTED, added by the ALTER TYPE statements in the
-- migration immediately before this one. Running as its own migration lets those values commit
-- first. Metadata-level constraint changes only — no data touched, same as the previous
-- migration's own header already noted about this exact rebuild.

DROP INDEX "jobs_one_active_per_worker";
CREATE UNIQUE INDEX "jobs_one_active_per_worker"
  ON "jobs" ("worker_id")
  WHERE "worker_id" IS NOT NULL
    AND "status" IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'QUOTING', 'PAUSED_PARTS');

ALTER TABLE "jobs" DROP CONSTRAINT "jobs_matched_needs_worker";
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_matched_needs_worker" CHECK (
  "status" NOT IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
                   'COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'QUOTING', 'PAUSED_PARTS', 'QUOTE_REJECTED')
  OR "worker_id" IS NOT NULL
);
