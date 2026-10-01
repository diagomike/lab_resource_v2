-- A replacement need covers several broken or lost items of a lab at once (13 broken
-- chairs are one need, not thirteen).
BEGIN;

ALTER TABLE "NeedLine" ADD COLUMN "replacesItemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "NeedLine" SET "replacesItemIds" = ARRAY["replacesItemId"] WHERE "replacesItemId" IS NOT NULL;
ALTER TABLE "NeedLine" DROP CONSTRAINT "NeedLine_replacesItemId_fkey";
ALTER TABLE "NeedLine" DROP COLUMN "replacesItemId";

COMMIT;
