-- AlterTable
ALTER TABLE "ImportLine" ADD COLUMN     "procurementLineId" TEXT;

-- AddForeignKey
ALTER TABLE "ImportLine" ADD CONSTRAINT "ImportLine_procurementLineId_fkey" FOREIGN KEY ("procurementLineId") REFERENCES "ProcurementLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

