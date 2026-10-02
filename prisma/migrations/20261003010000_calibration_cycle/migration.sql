-- How often a category's items are calibrated (null: not calibrated).
ALTER TABLE "ResourceCategory" ADD COLUMN "calibrationCycleMonths" INTEGER;
