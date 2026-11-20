// SPDX-License-Identifier: AGPL-3.0-only

import { validatePercentSum } from "@skuu/formula";
import { z } from "zod";

export const wizardIngredientSchema = z.object({
  partCode: z.string().min(1),
  tradeName: z.string().min(1),
  inci: z.string().optional(),
  percentWw: z.number().min(0).max(100),
  phaseNumber: z.number().int().min(1).default(1)
});

export const wizardPhaseSchema = z.object({
  phaseNumber: z.number().int().min(1),
  instructions: z.string().default("")
});

export const wizardFillSchema = z.object({
  packSizeMl: z.number().positive(),
  unitsPerCase: z.number().int().positive().optional()
});

export const wizardPackagingLineSchema = z.object({
  fillIndex: z.number().int().min(0),
  partCode: z.string().min(1),
  name: z.string().min(1),
  qtyPerUnit: z.number().positive(),
  freeIssueByClient: z.boolean().default(false)
});

export const skuuProductWizardDraftSchema = z.object({
  customerId: z.string().min(1),
  productName: z.string().min(1),
  clientSkuRef: z.string().min(1),
  formulaRef: z.string().min(1),
  ingredients: z.array(wizardIngredientSchema).min(1),
  phases: z.array(wizardPhaseSchema).default([]),
  productDensityGPerMl: z.number().positive().nullable(),
  expectedYieldPercent: z.number().min(0.01).max(100),
  standardBatchKg: z.number().positive(),
  shelfLifeDays: z.number().int().positive().optional(),
  retestIntervalDays: z.number().int().positive().optional(),
  fills: z.array(wizardFillSchema).min(1),
  packaging: z.array(wizardPackagingLineSchema).default([])
});

export type SkuuProductWizardDraft = z.infer<typeof skuuProductWizardDraftSchema>;

export function wizardFormulaCheck(draft: Pick<SkuuProductWizardDraft, "ingredients">) {
  return validatePercentSum(
    draft.ingredients.map((line, i) => ({
      id: String(i),
      percentWw: line.percentWw
    }))
  );
}

export const WIZARD_DRAFT_STORAGE_KEY = "skuu-new-product-wizard-draft";