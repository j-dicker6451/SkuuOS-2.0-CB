// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import {
  grossInputKg,
  lineKgFromPercent,
  sumPercentWw,
  validatePercentSum
} from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkuuJobMaterialLotsByMethodMaterial } from "./skuu-job-material-lots";
import { buildSkuuPhasedFormulaBlocks } from "./skuu-phased-formula";
import { loadSkuuFormulationView } from "./skuu-formulation.service";
import { resolveSkuuBulkMakeMethodForJob } from "./skuu-job-bulk.server";

type Client = SupabaseClient<Database>;

export type BulkBatchTicketLine = {
  phaseNumber: number;
  methodMaterialId: string;
  partCode: string;
  name: string;
  percentWw: number;
  kg: number;
  grams: number;
  batchLots: Array<{
    trackedEntityReadableId: string | null;
    supplierBatchNumber: string | null;
    quantityKg: number;
  }>;
};

export type BulkBatchTicketPhase = {
  phaseNumber: number;
  instructions: string;
  lines: BulkBatchTicketLine[];
};

export type BulkBatchTicket = {
  productName: string;
  productCode: string;
  batchNumber: string;
  batchSizeKg: number;
  batchSizeL: number | null;
  densityGPerMl: number | null;
  expectedYieldPercent: number;
  targetFinishedKg: number;
  phases: BulkBatchTicketPhase[];
  percentTotal: number;
  percentOk: boolean;
};

export async function buildBulkBatchTicket(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<BulkBatchTicket | null> {
  const resolved = await resolveSkuuBulkMakeMethodForJob(client, args);
  if (!resolved) return null;

  const { data: job, error: jobErr } = await client
    .from("job")
    .select("id, jobId, itemId, quantity")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .single();
  if (jobErr || !job) return null;

  const { makeMethodId } = resolved;

  const { data: item } = await client
    .from("item")
    .select("readableId, name")
    .eq("id", job.itemId)
    .single();

  const view = await loadSkuuFormulationView(
    client,
    makeMethodId,
    args.companyId
  );
  if (!view.profile?.enabled) return null;

  const batchSizeKg = Number(job.quantity);
  const yieldPct = view.profile.expectedYieldPercent;
  const grossKg = grossInputKg(batchSizeKg, yieldPct);
  const density = view.profile.productDensityGPerMl;
  const batchSizeL = density && density > 0 ? grossKg / density : null;

  const blocks = buildSkuuPhasedFormulaBlocks(
    view.phases,
    view.materials,
    view.profile
  );

  const lotsByMethodMaterial = await loadSkuuJobMaterialLotsByMethodMaterial(
    client,
    args.companyId,
    args.jobId
  );

  const lines: BulkBatchTicketLine[] = blocks.flatMap((block) =>
    block.lines.map((line) => {
      const code = line.itemReadableId ?? line.methodMaterialId;
      return {
        phaseNumber: block.phaseNumber,
        methodMaterialId: line.methodMaterialId,
        partCode: code,
        name: line.itemName ?? "",
        percentWw: Number(line.percentWw),
        kg: line.kgPerBatch ?? lineKgFromPercent(Number(line.percentWw), grossKg),
        grams:
          (line.kgPerBatch ??
            lineKgFromPercent(Number(line.percentWw), grossKg)) * 1000,
        batchLots: lotsByMethodMaterial.get(line.methodMaterialId) ?? []
      };
    })
  );

  const ingredientLines = view.materials.filter(
    (m) => m.lineKind !== "bulk_lot_rework" && m.percentWw != null
  );

  const check = validatePercentSum(
    ingredientLines.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );
  const total = sumPercentWw(
    ingredientLines.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );

  const phases: BulkBatchTicketPhase[] = blocks.map((block) => ({
    phaseNumber: block.phaseNumber,
    instructions: block.instructions,
    lines: lines.filter((l) => l.phaseNumber === block.phaseNumber)
  }));

  return {
    productName: item?.name ?? "",
    productCode: item?.readableId ?? job.itemId,
    batchNumber: job.jobId ?? job.id,
    batchSizeKg,
    batchSizeL,
    densityGPerMl: density,
    expectedYieldPercent: yieldPct,
    targetFinishedKg: batchSizeKg,
    phases,
    percentTotal: total,
    percentOk: check.ok
  };
}