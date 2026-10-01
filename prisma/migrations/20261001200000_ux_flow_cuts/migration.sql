-- UX-flow round (2026-10-01): the cuts. STAFF and STUDENT roles, access views, approval
-- policies, the per-department draft switch and lab ideals go; needs gain a lab,
-- priority, kind and specification.

BEGIN;

-- Data the narrowed enums can no longer hold.
DELETE FROM "UserRole" WHERE "kind" IN ('STAFF', 'STUDENT');
UPDATE "Invitation" SET "intendedRole" = 'CUSTODIAN' WHERE "intendedRole" IN ('STAFF', 'STUDENT');
DELETE FROM "LabCommitRequest" WHERE "targetKind" = 'IDEAL';
DELETE FROM "LabVersion" WHERE "kind" IN ('IDEAL', 'IDEAL_PROPOSAL');


-- CreateEnum
CREATE TYPE "NeedPriority" AS ENUM ('ESSENTIAL', 'IMPORTANT', 'NICE_TO_HAVE');

-- CreateEnum
CREATE TYPE "NeedKind" AS ENUM ('NEW', 'REPLACEMENT');

-- AlterEnum
CREATE TYPE "DraftTargetKind_new" AS ENUM ('VISIBLE');
ALTER TABLE "LabCommitRequest" ALTER COLUMN "targetKind" TYPE "DraftTargetKind_new" USING ("targetKind"::text::"DraftTargetKind_new");
ALTER TYPE "DraftTargetKind" RENAME TO "DraftTargetKind_old";
ALTER TYPE "DraftTargetKind_new" RENAME TO "DraftTargetKind";
DROP TYPE "public"."DraftTargetKind_old";

-- AlterEnum
CREATE TYPE "LabVersionKind_new" AS ENUM ('DRAFT');
ALTER TABLE "LabVersion" ALTER COLUMN "kind" TYPE "LabVersionKind_new" USING ("kind"::text::"LabVersionKind_new");
ALTER TYPE "LabVersionKind" RENAME TO "LabVersionKind_old";
ALTER TYPE "LabVersionKind_new" RENAME TO "LabVersionKind";
DROP TYPE "public"."LabVersionKind_old";

-- AlterEnum
CREATE TYPE "LabVersionStatus_new" AS ENUM ('EDITING', 'SUBMITTED');
ALTER TABLE "public"."LabVersion" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "LabVersion" ALTER COLUMN "status" TYPE "LabVersionStatus_new" USING ("status"::text::"LabVersionStatus_new");
ALTER TYPE "LabVersionStatus" RENAME TO "LabVersionStatus_old";
ALTER TYPE "LabVersionStatus_new" RENAME TO "LabVersionStatus";
DROP TYPE "public"."LabVersionStatus_old";
ALTER TABLE "LabVersion" ALTER COLUMN "status" SET DEFAULT 'EDITING';

-- Tables that still use the old role type go first.
-- DropForeignKey
ALTER TABLE "AccessViewAudience" DROP CONSTRAINT "AccessViewAudience_personId_fkey";

-- DropForeignKey
ALTER TABLE "AccessViewAudience" DROP CONSTRAINT "AccessViewAudience_viewId_fkey";

-- DropTable
DROP TABLE "AccessView";

-- DropTable
DROP TABLE "AccessViewAudience";

-- DropTable
DROP TABLE "ApprovalPolicy";

-- AlterEnum
CREATE TYPE "RoleKind_new" AS ENUM ('SYS_ADMIN', 'PROPERTY_ADMIN', 'PROCUREMENT', 'MANAGER', 'CUSTODIAN', 'STORE_KEEPER', 'EXTERNAL');
ALTER TABLE "UserRole" ALTER COLUMN "kind" TYPE "RoleKind_new" USING ("kind"::text::"RoleKind_new");
ALTER TABLE "Invitation" ALTER COLUMN "intendedRole" TYPE "RoleKind_new" USING ("intendedRole"::text::"RoleKind_new");
ALTER TYPE "RoleKind" RENAME TO "RoleKind_old";
ALTER TYPE "RoleKind_new" RENAME TO "RoleKind";
DROP TYPE "public"."RoleKind_old";

-- AlterTable
ALTER TABLE "NeedLine" ADD COLUMN     "kind" "NeedKind" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "labItemId" TEXT,
ADD COLUMN     "priority" "NeedPriority" NOT NULL DEFAULT 'IMPORTANT',
ADD COLUMN     "replacesItemId" TEXT,
ADD COLUMN     "spec" TEXT;

-- AlterTable
ALTER TABLE "OrgNode" DROP COLUMN "draftWorkflowEnabled";

-- DropEnum
DROP TYPE "PolicyOutcome";

-- DropEnum
DROP TYPE "ScopeMode";

-- DropEnum
DROP TYPE "ViewAudienceType";

-- CreateIndex
CREATE INDEX "NeedLine_labItemId_idx" ON "NeedLine"("labItemId");

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NeedLine" ADD CONSTRAINT "NeedLine_replacesItemId_fkey" FOREIGN KEY ("replacesItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
