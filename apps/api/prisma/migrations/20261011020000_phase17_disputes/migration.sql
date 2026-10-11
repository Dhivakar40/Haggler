-- Phase Commerce + Safety, Sub-phase D: disputes. Additive only — two new enums, one new table.
-- JobStatus.DISPUTED/REFUNDED and WorkerStats.jobsDisputed already existed (D-076) with no live
-- flow setting them; this migration adds the table that records the dispute itself, not a new
-- job-status value.

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "dispute_resolution" AS ENUM ('REFUND_CUSTOMER', 'PAY_WORKER', 'NO_ACTION');

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "raised_by" UUID NOT NULL,
    "role" "party_role" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "resolution" "dispute_resolution",
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "disputes_job_id_idx" ON "disputes"("job_id");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
