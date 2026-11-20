// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import {
  grossInputKg,
  lineKgFromPercent,
  sumPercentWw,
  validatePercentSum
} from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export type BulkBatchTicket = {
  productName: string;
  productCode: string;
  batchNumber: string;
  batchSizeKg: number;
  batchSizeL: number | null;
  densityGPerMl: number | null;
  expectedYieldPercent: number;
  targetFinishedKg: number;
  phases: Array<{ phaseNumber: number; instructions: string }>;
  linesByPhase: Map<number, BulkBatchTicketLine[]>;
  percentTotal: number;
  percentOk: boolean;
};

export async function buildBulkBatchTicket(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<BulkBatchTicket | null> {
  const { data: job, error: jobErr } = await client
    .from("job")
    .select("id, jobId, itemId, quantity, makeMethodId")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .single();
  if (jobErr || !job?.makeMethodId) return null;

  const { data: item } = await client
    .from("item")
    .select("readableId, name")
    .eq("id", job.itemId)
    .single();

  const view = await loadSkuuFormulationView(
    client,
    job.makeMethodId,
    args.companyId
  );
  if (!view.profile?.enabled) return null;

  const batchSizeKg = Number(job.quantity);
  const yieldPct = view.profile.expectedYieldPercent;
  const grossKg = grossInputKg(batchSizeKg, yieldPct);
  const density = view.profile.productDensityGPerMl;
  const batchSizeL = density && density > 0 ? grossKg / density : null;

  const lines: BulkBatchTicketLine[] = view.materials
    .filter((m) => m.lineKind !== "bulk_lot_rework" && m.percentWw != null)
    .map((m) => {
      const pct = Number(m.percentWw);
      const kg = lineKgFromPercent(pct, grossKg);
      return {
        phaseNumber: m.phaseNumber ?? 1,
        partCode: m.itemReadableId ?? m.itemId,
        name: m.itemName ?? "",
        percentWw: pct,
        kg,
        grams: kg * 1000
      };
    });

  const linesByPhase = new Map<number, BulkBatchTicketLine[]>();
  for (const line of lines) {
    const bucket = linesByPhase.get(line.phaseNumber) ?? [];
    bucket.push(line);
    linesByPhase.set(line.phaseNumber, bucket);
  }

  const check = validatePercentSum(
    view.materials.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );
  const total = sumPercentWw(
    view.materials.map((m) => ({
      id: m.methodMaterialId,
      percentWw: m.percentWw
    }))
  );

  const phases =
    view.phases.length > 0
      ? view.phases
      : [{ phaseNumber: 1, instructions: "", methodOperationId: null }].map(
          (p) => ({ phaseNumber: p.phaseNumber, instructions: p.instructions })
        );

  return {
    productName: item?.name ?? "",
    productCode: item?.readableId ?? job.itemId,
    batchNumber: job.jobId ?? job.id,
    batchSizeKg,
    batchSizeL,
    densityGPerMl: density,
    expectedYieldPercent: yieldPct,
    targetFinishedKg: batchSizeKg,
    phases: phases.map((p) => ({
      phaseNumber: p.phaseNumber,
      instructions: p.instructions
    })),
    linesByPhase,
    percentTotal: total,
    percentOk: check.ok
  };
}
