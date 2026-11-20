// SPDX-License-Identifier: AGPL-3.0-only

import { z } from "zod";
import { zfd } from "zod-form-data";

export const skuuBulkProfileValidator = z.object({
  makeMethodId: z.string().min(1),
  enabled: zfd.checkbox(),
  batchBasisKg: zfd.numeric(z.number().positive().default(1)),
  productDensityGPerMl: zfd.numeric(z.number().positive().optional()),
  expectedYieldPercent: zfd.numeric(z.number().min(0.01).max(100).default(100)),
  yieldLossPercent: zfd.numeric(z.number().min(0).max(99.99).default(0))
});

export const skuuMaterialPercentValidator = z.object({
  methodMaterialId: z.string().min(1),
  percentWw: zfd.numeric(z.number().min(0).max(100).nullable()),
  phaseNumber: zfd.numeric(z.number().int().min(1).optional()),
  lineKind: z.enum(["ingredient", "bulk_lot_rework"]).optional(),
  sourceTrackedEntityId: z.string().optional(),
  reworkPercentWw: zfd.numeric(z.number().min(0).max(100).optional())
});

export const skuuFormulaPhaseValidator = z.object({
  makeMethodId: z.string().min(1),
  phaseNumber: zfd.numeric(z.number().int().min(1)),
  instructions: z.string().max(16000).default(""),
  methodOperationId: z.string().optional()
});

const roundKg3 = (n: number) => Math.round(n * 1000) / 1000;

export const skuuDispenseRowValidator = z.object({
  jobId: z.string().min(1),
  jobMaterialId: z.string().min(1),
  quantityKg: zfd
    .numeric(z.number().positive())
    .transform((n) => roundKg3(n)),
  supplierBatchNumber: z.string().optional(),
  trackedEntityId: z.string().optional()
});

export const skuuDispenseMarkValidator = z.object({
  jobId: z.string().min(1),
  dispenseId: z.string().min(1),
  markedAdded: zfd.checkbox().optional(),
  correctionReason: z.string().optional()
});

export const skuuBatchRecordCompleteValidator = z.object({
  jobId: z.string().min(1),
  phaseNumber: zfd.numeric(z.number().int().min(1)),
  notes: z.string().max(8000).optional(),
  correctionReason: z.string().max(2000).optional()
});
