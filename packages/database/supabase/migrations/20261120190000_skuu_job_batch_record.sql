-- SkuuOS digital batch record: phase completion + dispense execution fields.

CREATE TABLE "skuuJobPhaseRecord" (
  "jobId" TEXT NOT NULL,
  "phaseNumber" INTEGER NOT NULL,
  "companyId" TEXT NOT NULL,
  "completedAt" TIMESTAMPTZ,
  "completedBy" TEXT,
  "notes" TEXT,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "correctionReason" TEXT,
  "correctedAt" TIMESTAMPTZ,
  "correctedBy" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "skuuJobPhaseRecord_pkey" PRIMARY KEY ("jobId", "phaseNumber"),
  CONSTRAINT "skuuJobPhaseRecord_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuJobPhaseRecord_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuJobPhaseRecord_completedBy_fkey"
    FOREIGN KEY ("completedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuJobPhaseRecord_correctedBy_fkey"
    FOREIGN KEY ("correctedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuJobPhaseRecord_number_positive" CHECK ("phaseNumber" >= 1)
);

CREATE INDEX "skuuJobPhaseRecord_companyId_idx" ON "skuuJobPhaseRecord" ("companyId");

ALTER TABLE "skuuJobPhaseRecord" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuJobPhaseRecord"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuJobPhaseRecord"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuJobPhaseRecord"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

ALTER TABLE "skuuJobMaterialDispense"
  ADD COLUMN IF NOT EXISTS "markedAdded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "addedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "addedBy" TEXT REFERENCES "user"("id"),
  ADD COLUMN IF NOT EXISTS "correctionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "correctedBy" TEXT REFERENCES "user"("id");