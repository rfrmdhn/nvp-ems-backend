-- Rename columns in place (not drop+add) so existing rows keep their
-- created_at/updated_at values instead of being reset to defaults.
ALTER TABLE "employees" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "employees" RENAME COLUMN "updatedAt" TO "updated_at";
