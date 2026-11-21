-- Skuu formulation version change control (per makeMethod version row)

CREATE TYPE "public"."skuuFormulationStatus" AS ENUM (
  'draft',
  'pending_approval',
  'approved',
  'superseded',
  'withdrawn'
);

CREATE TABLE "public"."skuuFormulationRevision" (
  "makeMethodId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "version" NUMERIC(10, 2) NOT NULL,
  "status" "public"."skuuFormulationStatus" NOT NULL DEFAULT 'draft',
  "changeReason" TEXT NOT NULL,
  "sourceMakeMethodId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ,
  "submittedBy" TEXT,
  "approvedAt" TIMESTAMPTZ,
  "approvedBy" TEXT,
  "withdrawnAt" TIMESTAMPTZ,
  "withdrawnBy" TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "skuuFormulationRevision_pkey" PRIMARY KEY ("makeMethodId"),
  CONSTRAINT "skuuFormulationRevision_makeMethodId_fkey"
    FOREIGN KEY ("makeMethodId") REFERENCES "public"."makeMethod"("id") ON DELETE CASCADE,
  CONSTRAINT "skuuFormulationRevision_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "public"."company"("id"),
  CONSTRAINT "skuuFormulationRevision_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "public"."item"("id"),
  CONSTRAINT "skuuFormulationRevision_sourceMakeMethodId_fkey"
    FOREIGN KEY ("sourceMakeMethodId") REFERENCES "public"."makeMethod"("id") ON DELETE SET NULL,
  CONSTRAINT "skuuFormulationRevision_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id"),
  CONSTRAINT "skuuFormulationRevision_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id"),
  CONSTRAINT "skuuFormulationRevision_reason_nonempty" CHECK (length(trim("changeReason")) > 0)
);

CREATE INDEX "skuuFormulationRevision_companyId_idx"
  ON "public"."skuuFormulationRevision" ("companyId");
CREATE INDEX "skuuFormulationRevision_itemId_idx"
  ON "public"."skuuFormulationRevision" ("itemId", "status");

ALTER TABLE "public"."job"
  ADD COLUMN IF NOT EXISTS "skuuFormulationMakeMethodId" TEXT
    REFERENCES "public"."makeMethod"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."job"."skuuFormulationMakeMethodId" IS
  'Skuu bulk formulation makeMethod version pinned when the job was created.';

ALTER TABLE "public"."skuuFormulationRevision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "public"."skuuFormulationRevision"
FOR SELECT USING (
  "companyId" = ANY (
  (
    SELECT
      get_companies_with_employee_permission('parts_view')
  )::text[]
  )
);

CREATE POLICY "INSERT" ON "public"."skuuFormulationRevision"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
  (
    SELECT
      get_companies_with_employee_permission('parts_create')
  )::text[]
  )
);

CREATE POLICY "UPDATE" ON "public"."skuuFormulationRevision"
FOR UPDATE USING (
  "companyId" = ANY (
  (
    SELECT
      get_companies_with_employee_permission('parts_update')
  )::text[]
  )
);

CREATE POLICY "DELETE" ON "public"."skuuFormulationRevision"
FOR DELETE USING (
  "companyId" = ANY (
  (
    SELECT
      get_companies_with_employee_permission('parts_delete')
  )::text[]
  )
);

-- Backfill: Active Skuu bulk methods → V1 Approved (PLUS01 / existing production baseline)
INSERT INTO "public"."skuuFormulationRevision" (
  "makeMethodId",
  "companyId",
  "itemId",
  "version",
  "status",
  "changeReason",
  "createdBy",
  "updatedBy",
  "approvedAt",
  "approvedBy"
)
SELECT
  mm.id,
  mm."companyId",
  mm."itemId",
  mm.version,
  'approved'::"public"."skuuFormulationStatus",
  'Initial approved baseline (Skuu formulation change control migration)',
  mm."createdBy",
  mm."updatedBy",
  mm."updatedAt",
  mm."updatedBy"
FROM "public"."makeMethod" mm
INNER JOIN "public"."skuuMakeMethodBulk" sb
  ON sb."makeMethodId" = mm.id
  AND sb.enabled = true
WHERE mm.status = 'Active'
ON CONFLICT ("makeMethodId") DO NOTHING;