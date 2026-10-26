-- D-103: additive only. New nullable/default-empty columns on student_profiles for the
-- professional/skills detail a student can fill in (and edit any time) separately from the
-- set-once date of birth. No columns dropped, no existing data touched.

ALTER TABLE "student_profiles" ADD COLUMN "course_of_study" TEXT;
ALTER TABLE "student_profiles" ADD COLUMN "year_of_study" TEXT;
ALTER TABLE "student_profiles" ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "student_profiles" ADD COLUMN "availability_hours_per_week" INTEGER;
ALTER TABLE "student_profiles" ADD COLUMN "bio" TEXT;
ALTER TABLE "student_profiles" ADD COLUMN "portfolio_url" TEXT;
