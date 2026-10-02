-- AlterTable
ALTER TABLE "VersionItem" ADD COLUMN     "touched" BOOLEAN NOT NULL DEFAULT false;

-- Drafts already in progress: which rows their custodians changed was never recorded, so
-- every existing row counts as changed — those drafts behave exactly as before.
UPDATE "VersionItem" SET "touched" = true;
