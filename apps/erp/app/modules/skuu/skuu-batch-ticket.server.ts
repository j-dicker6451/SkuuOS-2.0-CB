// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import {
  grossInputKg,
  lineKgFromPercent,
  sumPercentWw,
  validatePercentSum
} from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSkuuPhasedFormulaBlocks } from "./skuu-phased-formula";
import { loadSkuuFormulationView } from "./skuu-formulation.service";

type Client = SupabaseClient<Database>;

export type BulkBatchTicketLine = {
  phaseNumber: number;
  partCode: string;
  name: string;
  percentWw: number;
  kg: number;
  grams: number;
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

async function resolveJobMakeMethodId(
  client: Client,
  jobId: string,
  companyId: string
): Promise<string | null> {
  const { data: jmm } = await client
    .from("jobMakeMethod")
    .select("makeMethodId")
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  return jmm?.makeMethodId ?? null;
}

export async function buildBulkBatchTicket(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<BulkBatchTicket | null> {
  const { data: job, error: jobErr } = await client
    .from("job")
    .select("id, jobId, itemId, quantity")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .single();
  if (jobErr || !job) return null;

  const makeMethodId = await resolveJobMakeMethodId(
    client,
    args.jobId,
    args.companyId
  );
  if (!makeMethodId) return null;

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

  const lines: BulkBatchTicketLine[] = blocks.flatMap((block) =>
    block.lines.map((line) => ({
      phaseNumber: block.phaseNumber,
      partCode: line.itemReadableId ?? line.methodMaterialId,
      name: line.itemName ?? "",
      percentWw: Number(line.percentWw),
      kg: line.kgPerBatch ?? lineKgFromPercent(Number(line.percentWw), grossKg),
      grams: (line.kgPerBatch ?? lineKgFromPercent(Number(line.percentWw), grossKg)) * 1000
    }))
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