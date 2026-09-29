-- CreateEnum
CREATE TYPE "gender" AS ENUM ('FEMALE', 'MALE', 'OTHER');

-- CreateEnum
CREATE TYPE "gender_preference" AS ENUM ('ANY', 'FEMALE', 'MALE');

-- CreateEnum
CREATE TYPE "urgency" AS ENUM ('IMMEDIATE', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('REQUESTED', 'BROADCASTING', 'MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER', 'CANCELLED', 'NO_SHOW_WORKER', 'NO_SHOW_CUSTOMER', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('PHOTO', 'VOICE');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'DELETED');

-- CreateEnum
CREATE TYPE "offer_status" AS ENUM ('PENDING', 'ACCEPTED', 'COUNTERED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "party_role" AS ENUM ('CUSTOMER', 'WORKER');

-- CreateEnum
CREATE TYPE "job_photo_kind" AS ENUM ('BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "broadcast_response" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'TAKEN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'UPI');

-- CreateEnum
CREATE TYPE "badge_tier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND');

-- AlterTable
ALTER TABLE "worker_profiles" ADD COLUMN     "gender" "gender",
ADD COLUMN     "is_online" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_location" geography(Point,4326),
ADD COLUMN     "last_location_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "location" geography(Point,4326) NOT NULL,
    "urgency" "urgency" NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6),
    "gender_preference" "gender_preference" NOT NULL DEFAULT 'ANY',
    "band_scope" "price_band_scope" NOT NULL,
    "band_min_paise" INTEGER NOT NULL,
    "band_median_paise" INTEGER NOT NULL,
    "band_max_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "worker_id" UUID,
    "status" "job_status" NOT NULL DEFAULT 'REQUESTED',
    "agreed_price_paise" INTEGER,
    "current_wave" INTEGER NOT NULL DEFAULT 0,
    "next_wave_at" TIMESTAMPTZ(6),
    "broadcast_deadline" TIMESTAMPTZ(6),
    "gender_preference_met" BOOLEAN,
    "arrival_code_hash" TEXT,
    "arrival_code_enc" TEXT,
    "arrival_code_tries" INTEGER NOT NULL DEFAULT 0,
    "arrival_verified_at" TIMESTAMPTZ(6),
    "matched_at" TIMESTAMPTZ(6),
    "agreed_at" TIMESTAMPTZ(6),
    "en_route_at" TIMESTAMPTZ(6),
    "arrived_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_by_worker_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" TEXT,
    "cancel_reason" TEXT,
    "cancellation_fee_applies" BOOLEAN NOT NULL DEFAULT false,
    "payment_method" "payment_method",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_broadcasts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "wave" INTEGER NOT NULL,
    "worker_id" UUID NOT NULL,
    "distance_m" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "response" "broadcast_response" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "request_id" UUID,
    "kind" "media_kind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "duration_seconds" INTEGER,
    "status" "media_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "from_role" "party_role" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "outside_band" BOOLEAN NOT NULL DEFAULT false,
    "status" "offer_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "from_status" "job_status",
    "to_status" "job_status" NOT NULL,
    "actor_user_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "kind" "job_photo_kind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "media_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "location" geography(Point,4326) NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "client_msg_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_shares" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "trusted_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_stats" (
    "worker_user_id" UUID NOT NULL,
    "jobs_completed" INTEGER NOT NULL DEFAULT 0,
    "badge_tier" "badge_tier" NOT NULL DEFAULT 'BRONZE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_stats_pkey" PRIMARY KEY ("worker_user_id")
);

-- CreateIndex
CREATE INDEX "service_requests_customer_id_created_at_idx" ON "service_requests"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_request_id_key" ON "jobs"("request_id");

-- CreateIndex
CREATE INDEX "jobs_customer_id_created_at_idx" ON "jobs"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_worker_id_created_at_idx" ON "jobs"("worker_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_next_wave_at_idx" ON "jobs"("status", "next_wave_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_matches_job_id_key" ON "job_matches"("job_id");

-- CreateIndex
CREATE INDEX "request_broadcasts_worker_id_response_idx" ON "request_broadcasts"("worker_id", "response");

-- CreateIndex
CREATE UNIQUE INDEX "request_broadcasts_job_id_worker_id_key" ON "request_broadcasts"("job_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "request_media_storage_key_key" ON "request_media"("storage_key");

-- CreateIndex
CREATE INDEX "request_media_owner_id_idx" ON "request_media"("owner_id");

-- CreateIndex
CREATE INDEX "request_media_request_id_idx" ON "request_media"("request_id");

-- CreateIndex
CREATE INDEX "offers_status_expires_at_idx" ON "offers"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "offers_job_id_round_key" ON "offers"("job_id", "round");

-- CreateIndex
CREATE INDEX "job_events_job_id_created_at_idx" ON "job_events"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_photos_storage_key_key" ON "job_photos"("storage_key");

-- CreateIndex
CREATE INDEX "job_photos_job_id_kind_idx" ON "job_photos"("job_id", "kind");

-- CreateIndex
CREATE INDEX "job_locations_job_id_recorded_at_idx" ON "job_locations"("job_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_threads_job_id_key" ON "chat_threads"("job_id");

-- CreateIndex
CREATE INDEX "chat_messages_thread_id_created_at_id_idx" ON "chat_messages"("thread_id", "created_at" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_thread_id_sender_id_client_msg_id_key" ON "chat_messages"("thread_id", "sender_id", "client_msg_id");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_shares_token_hash_key" ON "trusted_shares"("token_hash");

-- CreateIndex
CREATE INDEX "trusted_shares_job_id_idx" ON "trusted_shares"("job_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_id_idx" ON "blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blocker_id_blocked_id_key" ON "blocks"("blocker_id", "blocked_id");

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_broadcasts" ADD CONSTRAINT "request_broadcasts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_media" ADD CONSTRAINT "request_media_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_locations" ADD CONSTRAINT "job_locations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_shares" ADD CONSTRAINT "trusted_shares_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Raw SQL that Prisma cannot express (Phase 2)
-- ---------------------------------------------------------------------------

-- THE double-booking guard: a Ranger can have at most ONE active job, enforced by the database.
-- "Active" = matched .. in_progress. (completed_by_worker frees the Ranger; the customer's
-- confirmation is not allowed to block them from new work.) Even if application checks, Redis
-- locks and two API servers all disagree, the second INSERT/UPDATE fails here.
CREATE UNIQUE INDEX "jobs_one_active_per_worker"
  ON "jobs" ("worker_id")
  WHERE "worker_id" IS NOT NULL
    AND "status" IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS');

-- A job with a Ranger must have passed through matching; a broadcasting job has none.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_price_positive" CHECK ("agreed_price_paise" IS NULL OR "agreed_price_paise" > 0),
  ADD CONSTRAINT "jobs_worker_not_customer" CHECK ("worker_id" IS NULL OR "worker_id" <> "customer_id"),
  ADD CONSTRAINT "jobs_wave_range" CHECK ("current_wave" BETWEEN 0 AND 10),
  ADD CONSTRAINT "jobs_matched_needs_worker" CHECK (
    "status" NOT IN ('MATCHED', 'NEGOTIATING', 'AGREED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS',
                     'COMPLETED_BY_WORKER', 'CONFIRMED_BY_CUSTOMER') OR "worker_id" IS NOT NULL
  );

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_amount_positive" CHECK ("amount_paise" > 0),
  ADD CONSTRAINT "offers_round_range" CHECK ("round" BETWEEN 1 AND 3);

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_band_ordered" CHECK ("band_min_paise" <= "band_median_paise" AND "band_median_paise" <= "band_max_paise"),
  ADD CONSTRAINT "service_requests_desc_len" CHECK (char_length("description") BETWEEN 5 AND 1000),
  ADD CONSTRAINT "service_requests_in_india" CHECK (
    ST_Y("location"::geometry) BETWEEN 6.0 AND 37.5 AND ST_X("location"::geometry) BETWEEN 68.0 AND 98.0
  ),
  ADD CONSTRAINT "service_requests_scheduled_needs_time" CHECK ("urgency" = 'IMMEDIATE' OR "scheduled_for" IS NOT NULL);

ALTER TABLE "request_media"
  ADD CONSTRAINT "request_media_size" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
  ADD CONSTRAINT "request_media_voice_len" CHECK ("kind" <> 'VOICE' OR ("duration_seconds" IS NOT NULL AND "duration_seconds" BETWEEN 1 AND 60));

ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_size" CHECK ("size_bytes" BETWEEN 1 AND 10485760);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_len" CHECK (char_length("body") BETWEEN 1 AND 2000);
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_not_self" CHECK ("blocker_id" <> "blocked_id");

-- One live BEFORE and one live AFTER photo per job.
CREATE UNIQUE INDEX "job_photos_one_live_per_kind"
  ON "job_photos" ("job_id", "kind") WHERE "status" <> 'DELETED';

-- Only one PENDING offer per job at a time.
CREATE UNIQUE INDEX "offers_one_pending_per_job" ON "offers" ("job_id") WHERE "status" = 'PENDING';

-- Spatial indexes: "who is near this point" must be an index scan.
CREATE INDEX "worker_profiles_last_location_gist" ON "worker_profiles" USING GIST ("last_location");
CREATE INDEX "service_requests_location_gist" ON "service_requests" USING GIST ("location");
CREATE INDEX "job_locations_location_gist" ON "job_locations" USING GIST ("location");

-- job_events is append-only, like audit_logs.
CREATE FUNCTION job_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'job_events is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_events_no_update_delete
  BEFORE UPDATE ON "job_events"
  FOR EACH ROW EXECUTE FUNCTION job_events_immutable();
