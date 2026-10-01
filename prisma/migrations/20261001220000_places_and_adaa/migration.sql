-- Places and the ADAA (2026-10-01). A category is either a PLACE (a lab, workshop,
-- studio or store — top level only) or a THING: it goes into any place, or inside a
-- thing whose parts ("Made of") include it. "Can be root", the ANYWHERE / ONLY_LISTED
-- mode and the placement allow-lists go. The Associate Dean for Academic Affairs is a
-- role that runs a college's labs and stores.

-- A new enum value is added outside the transaction (it can't be used in the one that adds it).
ALTER TYPE "RoleKind" ADD VALUE IF NOT EXISTS 'ADAA';

BEGIN;

ALTER TABLE "ResourceCategory" ADD COLUMN "isPlace" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ResourceCategory" SET "isPlace" = "canBeRoot";

ALTER TABLE "CategoryPlacementRule" DROP CONSTRAINT "CategoryPlacementRule_childCategoryId_fkey";
ALTER TABLE "CategoryPlacementRule" DROP CONSTRAINT "CategoryPlacementRule_parentCategoryId_fkey";
DROP TABLE "CategoryPlacementRule";
ALTER TABLE "ResourceCategory" DROP COLUMN "canBeRoot", DROP COLUMN "placement";
DROP TYPE "CategoryPlacement";

COMMIT;
