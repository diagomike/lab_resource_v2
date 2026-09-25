-- A staged change keeps the reason the custodian gave, so the merge can log it (G-11).
ALTER TABLE "VersionItem" ADD COLUMN "note" TEXT;
