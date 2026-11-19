-- SkuuOS: formula phases, density, expected yield, multi-lot dispense scaffold
-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "skuuMakeMethodBulk"
  ADD COLUMN IF NOT EXISTS "productDensityGPerMl" NUMERIC,
  ADD COLUMN IF NOT EXISTS "expectedYieldPercent" NUMERIC NOT NULL DEFAULT 100;

ALTER TABLE "skuuMakeMethodBulk"
  DROP CONSTRAINT IF EXISTS "skuuMakeMethodBulk_yield_range";

ALTER TABLE "skuuMakeMethodBulk"
  ADD CONSTRAINT "skuuMakeMethodBulk_density_positive"
    CHECK ("productDensityGPerMl" IS NULL OR "productDensityGPerMl" > 0),
  ADD CONSTRAINT "skuuMakeMethodBulk_expected_yield_range"
    CHECK ("expectedYieldPercent" > 0 AND "expectedYieldPercent" <= 100);

COMMENT ON COLUMN "skuuMakeMethodBulk"."productDensityGPerMl" IS
  'SkuuOS: bulk product density (g/mL) for L ↔ kg on batch tickets.';
COMMENT ON COLUMN "skuuMakeMethodBulk"."expectedYieldPercent" IS
  'SkuuOS: expected process yield; manufacture qty = target / (yield%/100).';

CREATE TYPE "skuuFormulaLineKind" AS ENUM ('ingredient', 'bulk_lot_rework');

ALTER TABLE "skuuMethodMaterialFormula"
  ADD COLUMN IF NOT EXISTS "phaseNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "lineKind" "skuuFormulaLineKind" NOT NULL DEFAULT 'ingredient',
  ADD COLUMN IF NOT EXISTS "sourceTrackedEntityId" TEXT,
  ADD COLUMN IF NOT EXISTS "reworkPercentWw" NUMERIC;

ALTER TABLE "skuuMethodMaterialFormula"
  ADD CONSTRAINT "skuuMethodMaterialFormula_phase_positive"
    CHECK ("phaseNumber" IS NULL OR "phaseNumber" >= 1),
  ADD CONSTRAINT "skuuMethodMaterialFormula_rework_bulk_fk"
    FOREIGN KEY ("sourceTrackedEntityId") REFERENCES "trackedEntity"("id");

CREATE TABLE "skuuFormulaPhase" (
  "makeMethodId" TEXT NOT NULL,
  "phaseNumber" INTEGER NOT NULL,
  "companyId" TEXT NOT NULL,
  "instructions" TEXT NOT NULL DEFAULT '',
  "methodOperationId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "skuuFormulaPhase_pkey" PRIMARY KEY ("makeMethodId", "phaseNumber"),
  CONSTRAINT "skuuFormulaPhase_makeMethodId_fkey"
    FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuFormulaPhase_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuFormulaPhase_methodOperationId_fkey"
    FOREIGN KEY ("methodOperationId") REFERENCES "methodOperation"("id") ON DELETE SET NULL,
  CONSTRAINT "skuuFormulaPhase_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuFormulaPhase_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuFormulaPhase_number_positive" CHECK ("phaseNumber" >= 1)
);

CREATE INDEX "skuuFormulaPhase_companyId_idx" ON "skuuFormulaPhase" ("companyId");

ALTER TABLE "skuuFormulaPhase" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuFormulaPhase"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuFormulaPhase"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuFormulaPhase"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuFormulaPhase"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

-- Planned dispense rows (several lots per formula line); execution hooks come later.
CREATE TABLE "skuuJobMaterialDispense" (
  "id" TEXT NOT NULL DEFAULT nanoid(),
  "jobMaterialId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "trackedEntityId" TEXT,
  "quantityKg" NUMERIC NOT NULL,
  "supplierBatchNumber" TEXT,
  "storageLocationId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "skuuJobMaterialDispense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "skuuJobMaterialDispense_jobMaterialId_fkey"
    FOREIGN KEY ("jobMaterialId") REFERENCES "jobMaterial"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuJobMaterialDispense_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuJobMaterialDispense_trackedEntityId_fkey"
    FOREIGN KEY ("trackedEntityId") REFERENCES "trackedEntity"("id"),
  CONSTRAINT "skuuJobMaterialDispense_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuJobMaterialDispense_qty_positive" CHECK ("quantityKg" > 0)
);

CREATE INDEX "skuuJobMaterialDispense_jobMaterialId_idx"
  ON "skuuJobMaterialDispense" ("jobMaterialId");

ALTER TABLE "skuuJobMaterialDispense" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuJobMaterialDispense"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuJobMaterialDispense"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuJobMaterialDispense"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuJobMaterialDispense"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('production_update'))::text[]
  )
);