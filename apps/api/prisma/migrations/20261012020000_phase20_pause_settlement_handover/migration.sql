-- D-092 (Sub-phase I2/I3/I5): additive only. New nullable columns on jobs for the pause
-- reminder flag and the Ranger's work-done settlement proposal, plus a new item_handovers table.
-- No columns dropped, no existing data touched.

ALTER TABLE "jobs" ADD COLUMN "paused_overdue_notified_at" TIMESTAMPTZ(6);
ALTER TABLE "jobs" ADD COLUMN "pause_settlement_paise" INTEGER;
ALTER TABLE "jobs" ADD COLUMN "pause_settlement_bill_photo_id" UUID;
ALTER TABLE "jobs" ADD COLUMN "pause_settlement_proposed_at" TIMESTAMPTZ(6);

CREATE TABLE "item_handovers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "photo_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "workshop" TEXT NOT NULL,
    "expected_return_at" TIMESTAMPTZ(6) NOT NULL,
    "customer_signed_off_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "item_handovers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "item_handovers_job_id_idx" ON "item_handovers"("job_id");

ALTER TABLE "item_handovers" ADD CONSTRAINT "item_handovers_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
