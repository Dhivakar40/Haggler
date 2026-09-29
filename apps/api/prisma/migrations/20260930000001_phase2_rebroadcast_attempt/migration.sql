-- Re-broadcast support: the same Ranger may be invited again in a later attempt.
ALTER TABLE "jobs" ADD COLUMN "broadcast_attempt" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "request_broadcasts" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "request_broadcasts_job_id_worker_id_key";
CREATE UNIQUE INDEX "request_broadcasts_job_id_worker_id_attempt_key" ON "request_broadcasts"("job_id", "worker_id", "attempt");
