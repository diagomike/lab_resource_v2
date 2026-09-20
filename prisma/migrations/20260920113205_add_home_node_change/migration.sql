-- CreateTable
CREATE TABLE "HomeNodeChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNodeId" TEXT,
    "toNodeId" TEXT,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeNodeChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeNodeChange_userId_changedAt_idx" ON "HomeNodeChange"("userId", "changedAt");

-- AddForeignKey
ALTER TABLE "HomeNodeChange" ADD CONSTRAINT "HomeNodeChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeNodeChange" ADD CONSTRAINT "HomeNodeChange_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
