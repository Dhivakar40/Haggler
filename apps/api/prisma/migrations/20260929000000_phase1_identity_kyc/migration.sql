-- CreateEnum
CREATE TYPE "kyc_document_type" AS ENUM ('AADHAAR_FRONT', 'AADHAAR_BACK', 'SELFIE', 'ADDRESS_PROOF', 'TRADE_LICENSE');

-- CreateEnum
CREATE TYPE "kyc_document_status" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'DELETED');

-- CreateEnum
CREATE TYPE "kyc_check_status" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "kyc_decision" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_INFO');

-- CreateEnum
CREATE TYPE "reference_call_outcome" AS ENUM ('NOT_CALLED', 'VERIFIED', 'NOT_REACHABLE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'KYC_PROCESSING');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_scheduled_for" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "worker_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kyc_tier" INTEGER NOT NULL DEFAULT 0,
    "bio" TEXT,
    "experience_years" INTEGER,
    "aadhaar_last4_enc" TEXT,
    "date_of_birth_enc" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "worker_profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "worker_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "consent_purpose" NOT NULL,
    "version" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "tier" INTEGER NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual_admin',
    "status" "kyc_check_status" NOT NULL DEFAULT 'DRAFT',
    "raw_ref" TEXT,
    "reviewer_message" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kyc_check_id" UUID NOT NULL,
    "type" "kyc_document_type" NOT NULL,
    "bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "status" "kyc_document_status" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "uploaded_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kyc_check_id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "decision" "kyc_decision" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyc_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kyc_check_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "call_outcome" "reference_call_outcome" NOT NULL DEFAULT 'NOT_CALLED',
    "call_notes" TEXT,
    "called_at" TIMESTAMPTZ(6),
    "called_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "professional_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID,
    "caller_user_id" UUID NOT NULL,
    "callee_user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "duration_secs" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_profiles_user_id_key" ON "worker_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_categories_worker_profile_id_category_id_key" ON "worker_categories"("worker_profile_id", "category_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_user_id_idx" ON "emergency_contacts"("user_id");

-- CreateIndex
CREATE INDEX "consents_user_id_purpose_idx" ON "consents"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "kyc_checks_status_submitted_at_idx" ON "kyc_checks"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "kyc_checks_user_id_idx" ON "kyc_checks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_storage_key_key" ON "kyc_documents"("storage_key");

-- CreateIndex
CREATE INDEX "kyc_documents_kyc_check_id_idx" ON "kyc_documents"("kyc_check_id");

-- CreateIndex
CREATE INDEX "kyc_reviews_kyc_check_id_idx" ON "kyc_reviews"("kyc_check_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_references_kyc_check_id_key" ON "professional_references"("kyc_check_id");

-- CreateIndex
CREATE INDEX "call_sessions_caller_user_id_idx" ON "call_sessions"("caller_user_id");

-- CreateIndex
CREATE INDEX "call_sessions_callee_user_id_idx" ON "call_sessions"("callee_user_id");

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_categories" ADD CONSTRAINT "worker_categories_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "worker_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_categories" ADD CONSTRAINT "worker_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kyc_check_id_fkey" FOREIGN KEY ("kyc_check_id") REFERENCES "kyc_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_reviews" ADD CONSTRAINT "kyc_reviews_kyc_check_id_fkey" FOREIGN KEY ("kyc_check_id") REFERENCES "kyc_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_reviews" ADD CONSTRAINT "kyc_reviews_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_references" ADD CONSTRAINT "professional_references_kyc_check_id_fkey" FOREIGN KEY ("kyc_check_id") REFERENCES "kyc_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Raw SQL that Prisma cannot express (Phase 1)
-- ---------------------------------------------------------------------------

ALTER TABLE "worker_profiles"
  ADD CONSTRAINT "worker_profiles_tier_range" CHECK ("kyc_tier" BETWEEN 0 AND 3),
  ADD CONSTRAINT "worker_profiles_experience_range" CHECK ("experience_years" IS NULL OR "experience_years" BETWEEN 0 AND 70);

ALTER TABLE "emergency_contacts"
  ADD CONSTRAINT "emergency_contacts_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "professional_references"
  ADD CONSTRAINT "professional_references_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "kyc_checks"
  ADD CONSTRAINT "kyc_checks_tier_range" CHECK ("tier" BETWEEN 1 AND 3);

-- A person can have only ONE open check per tier. Re-submitting after "needs info" reuses it.
CREATE UNIQUE INDEX "kyc_checks_one_open_per_tier"
  ON "kyc_checks" ("user_id", "tier")
  WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO');

-- One live document per type per check; replaced documents are marked DELETED first.
CREATE UNIQUE INDEX "kyc_documents_one_live_per_type"
  ON "kyc_documents" ("kyc_check_id", "type")
  WHERE "status" <> 'DELETED';

-- One live consent per (user, purpose, version).
CREATE UNIQUE INDEX "consents_one_live"
  ON "consents" ("user_id", "purpose", "version")
  WHERE "revoked_at" IS NULL;

-- At most one default address per user.
CREATE UNIQUE INDEX "addresses_one_default_per_user"
  ON "addresses" ("user_id")
  WHERE "is_default";

-- Addresses must be in India (rough bounding box; catches swapped lat/lng and 0,0 mistakes).
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_pincode_fmt" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
  ADD CONSTRAINT "addresses_in_india" CHECK (
    "location" IS NULL OR (
      ST_Y("location"::geometry) BETWEEN 6.0 AND 37.5 AND
      ST_X("location"::geometry) BETWEEN 68.0 AND 98.0
    )
  );
