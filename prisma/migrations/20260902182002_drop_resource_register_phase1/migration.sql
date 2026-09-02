-- DropForeignKey
ALTER TABLE "CategoryField" DROP CONSTRAINT "CategoryField_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_currentOrgNodeId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_custodianId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_ownerOrgNodeId_fkey";

-- DropForeignKey
ALTER TABLE "Item" DROP CONSTRAINT "Item_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ResourceCategory" DROP CONSTRAINT "ResourceCategory_groupId_fkey";

-- DropTable
DROP TABLE "CategoryField";

-- DropTable
DROP TABLE "CategoryGroup";

-- DropTable
DROP TABLE "Item";

-- DropTable
DROP TABLE "ResourceCategory";

-- DropEnum
DROP TYPE "CategoryFieldType";

-- DropEnum
DROP TYPE "CountingMode";

-- DropEnum
DROP TYPE "ImpairRule";

-- DropEnum
DROP TYPE "ItemStatus";

