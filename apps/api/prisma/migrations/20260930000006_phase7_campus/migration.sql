-- Prisma's migrate-diff engine cannot see indexes on Unsupported("geography(...)") columns or
-- raw-SQL-created indexes from earlier migrations, so it always proposes dropping
-- addresses_location_gist, job_locations_location_gist, service_requests_location_gist,
-- worker_profiles_last_location_gist and payment_orders_status_idx whenever an unrelated schema
-- change is diffed. None of those indexes are touched by this migration; the spurious DROP INDEX
-- statements were removed by hand (see docs/DECISIONS.md and every migration since Phase 2).

-- AlterTable
ALTER TABLE "employer_profiles" ADD COLUMN     "verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "date_of_birth_enc" TEXT NOT NULL,
    "institute_name" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hourly_rate_paise" INTEGER NOT NULL,
    "hours_per_week" INTEGER NOT NULL,
    "is_night_shift" BOOLEAN NOT NULL DEFAULT false,
    "openings" INTEGER NOT NULL DEFAULT 1,
    "filled_count" INTEGER NOT NULL DEFAULT 0,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "status" "ContractListingStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "campus_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campus_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "cover_note" TEXT,
    "accepts_night_shift" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContractApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "campus_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE INDEX "campus_listings_status_category_id_created_at_idx" ON "campus_listings"("status", "category_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "campus_listings_employer_id_created_at_idx" ON "campus_listings"("employer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "campus_applications_student_id_applied_at_idx" ON "campus_applications"("student_id", "applied_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "campus_applications_listing_id_student_id_key" ON "campus_applications"("listing_id", "student_id");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_listings" ADD CONSTRAINT "campus_listings_employer_id_fkey" FOREIGN KEY ("employer_id") REFERENCES "employer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_listings" ADD CONSTRAINT "campus_listings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_applications" ADD CONSTRAINT "campus_applications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "campus_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campus_applications" ADD CONSTRAINT "campus_applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
