-- Bulk quantity invariants: SERIALIZED items are always exactly 1 unit; BULK
-- quantities can never go negative. Enforced in the database, not just app validation,
-- so a bug in applyChange cannot silently corrupt a count.
ALTER TABLE "Item" ADD CONSTRAINT "Item_qty_countingMode_check"
  CHECK (
    ("countingMode" = 'SERIALIZED' AND "qty" = 1) OR
    ("countingMode" = 'BULK' AND "qty" >= 0)
  );

-- A resource cannot be its own container. Cycle prevention at write time
-- (assertNoContainmentCycle) covers the general case; this is cheap insurance
-- against the one-line degenerate case slipping through any write path.
ALTER TABLE "Item" ADD CONSTRAINT "Item_no_self_parent_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
