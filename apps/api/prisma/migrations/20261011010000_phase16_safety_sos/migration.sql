-- Phase Commerce + Safety, Sub-phase C: SOS alerts. Additive only — one new enum, one new table.
-- Tier-3 (category-license) KYC needed no schema change: ServiceCategory.requiresLicense and
-- KycCheck.tier (plain Int) already supported it; this sub-phase only widened the application-
-- level type unions and wired enforcement.

-- CreateEnum
CREATE TYPE "sos_alert_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "sos_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "triggered_by" UUID NOT NULL,
    "role" "party_role" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "note" TEXT,
    "status" "sos_alert_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "sos_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sos_alerts_job_id_created_at_idx" ON "sos_alerts"("job_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sos_alerts_status_created_at_idx" ON "sos_alerts"("status", "created_at");

-- AddForeignKey
ALTER TABLE "sos_alerts" ADD CONSTRAINT "sos_alerts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
