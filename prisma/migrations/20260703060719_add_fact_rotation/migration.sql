-- CreateEnum
CREATE TYPE "FactRotationType" AS ENUM ('SCHEDULED', 'MANUAL', 'FALLBACK');

-- CreateTable
CREATE TABLE "FactRotation" (
    "id" TEXT NOT NULL,
    "factId" TEXT NOT NULL,
    "slotStartAt" TIMESTAMP(3) NOT NULL,
    "slotEndAt" TIMESTAMP(3) NOT NULL,
    "rotationType" "FactRotationType" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactRotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactRotation_factId_idx" ON "FactRotation"("factId");

-- CreateIndex
CREATE INDEX "FactRotation_slotStartAt_idx" ON "FactRotation"("slotStartAt");

-- CreateIndex
CREATE INDEX "FactRotation_slotEndAt_idx" ON "FactRotation"("slotEndAt");

-- CreateIndex
CREATE UNIQUE INDEX "FactRotation_slotStartAt_key" ON "FactRotation"("slotStartAt");

-- AddForeignKey
ALTER TABLE "FactRotation" ADD CONSTRAINT "FactRotation_factId_fkey" FOREIGN KEY ("factId") REFERENCES "Fact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
