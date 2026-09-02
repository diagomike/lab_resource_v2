-- CreateIndex
CREATE INDEX "Item_props_idx" ON "Item" USING GIN ("props" jsonb_path_ops);
