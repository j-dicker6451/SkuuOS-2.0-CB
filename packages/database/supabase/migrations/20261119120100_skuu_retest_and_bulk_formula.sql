-- SkuuOS: lot retest dates and bulk % w/w formula layer (AGPL extension)
-- SPDX-License-Identifier: AGPL-3.0-only

ALTER TABLE "trackedEntity"
  ADD COLUMN IF NOT EXISTS "retestDate" DATE;

CREATE INDEX IF NOT EXISTS "trackedEntity_retestDate_idx"
  ON "trackedEntity" ("retestDate")
  WHERE "retestDate" IS NOT NULL;

COMMENT ON COLUMN "trackedEntity"."retestDate" IS
  'SkuuOS: date by which this lot should be retested; distinct from expirationDate.';

CREATE TABLE "skuuItemRetest" (
  "itemId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "retestIntervalDays" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "skuuItemRetest_pkey" PRIMARY KEY ("itemId"),
  CONSTRAINT "skuuItemRetest_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuItemRetest_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuItemRetest_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuItemRetest_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuItemRetest_days_positive"
    CHECK ("retestIntervalDays" IS NULL OR "retestIntervalDays" > 0)
);

CREATE INDEX "skuuItemRetest_companyId_idx" ON "skuuItemRetest" ("companyId");

ALTER TABLE "skuuItemRetest" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuItemRetest"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuItemRetest"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuItemRetest"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuItemRetest"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE TABLE "skuuMakeMethodBulk" (
  "makeMethodId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "batchBasisKg" NUMERIC NOT NULL DEFAULT 1,
  "yieldLossPercent" NUMERIC NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "skuuMakeMethodBulk_pkey" PRIMARY KEY ("makeMethodId"),
  CONSTRAINT "skuuMakeMethodBulk_makeMethodId_fkey"
    FOREIGN KEY ("makeMethodId") REFERENCES "makeMethod"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuMakeMethodBulk_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuMakeMethodBulk_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuMakeMethodBulk_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuMakeMethodBulk_basis_positive" CHECK ("batchBasisKg" > 0),
  CONSTRAINT "skuuMakeMethodBulk_yield_range"
    CHECK ("yieldLossPercent" >= 0 AND "yieldLossPercent" < 100)
);

CREATE INDEX "skuuMakeMethodBulk_companyId_idx" ON "skuuMakeMethodBulk" ("companyId");

ALTER TABLE "skuuMakeMethodBulk" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuMakeMethodBulk"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuMakeMethodBulk"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuMakeMethodBulk"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuMakeMethodBulk"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE TABLE "skuuMethodMaterialFormula" (
  "methodMaterialId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "percentWw" NUMERIC,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "skuuMethodMaterialFormula_pkey" PRIMARY KEY ("methodMaterialId"),
  CONSTRAINT "skuuMethodMaterialFormula_methodMaterialId_fkey"
    FOREIGN KEY ("methodMaterialId") REFERENCES "methodMaterial"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuMethodMaterialFormula_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id"),
  CONSTRAINT "skuuMethodMaterialFormula_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuMethodMaterialFormula_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user"("id"),
  CONSTRAINT "skuuMethodMaterialFormula_percent_range"
    CHECK ("percentWw" IS NULL OR ("percentWw" >= 0 AND "percentWw" <= 100))
);

CREATE INDEX "skuuMethodMaterialFormula_companyId_idx"
  ON "skuuMethodMaterialFormula" ("companyId");

ALTER TABLE "skuuMethodMaterialFormula" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuMethodMaterialFormula"
FOR SELECT USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_view'))::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuMethodMaterialFormula"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_create'))::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuMethodMaterialFormula"
FOR UPDATE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuMethodMaterialFormula"
FOR DELETE USING (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('parts_update'))::text[]
  )
);