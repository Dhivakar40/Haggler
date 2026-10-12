-- D-093 (Sub-phase K1): additive only. Two new enums and one new table; nothing existing is
-- touched. FraudReviewItem is read-only from the app's point of view except for admin resolve —
-- nothing writes to a balance or a league from this table.

CREATE TYPE "fraud_signal_kind" AS ENUM ('VELOCITY', 'REPEAT_PAIR', 'LOW_VALUE');
CREATE TYPE "fraud_review_status" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED');

CREATE TABLE "fraud_review_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "fraud_signal_kind" NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "related_user_id" UUID,
    "detail" JSONB NOT NULL,
    "status" "fraud_review_status" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "fraud_review_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fraud_review_items_subject_user_id_idx" ON "fraud_review_items"("subject_user_id");
CREATE INDEX "fraud_review_items_status_created_at_idx" ON "fraud_review_items"("status", "created_at");
