// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkuuBulkProfile } from "./skuu-bulk.service";

type SkuuClient = SupabaseClient<Database>;

export type SkuuFormulaPhaseRow = {
  phaseNumber: number;
  instructions: string;
  methodOperationId: string | null;
};

export type SkuuFormulationMaterialLine = {
  methodMaterialId: string;
  itemId: string;
  itemReadableId: string | null;
  itemName: string | null;
  itemType: string;
  percentWw: number | null;
  phaseNumber: number | null;
  lineKind: string | null;
};

export async function loadSkuuFormulaPhases(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
): Promise<SkuuFormulaPhaseRow[]> {
  const { data, error } = await client
    .from("skuuFormulaPhase")
    .select("phaseNumber, instructions, methodOperationId")
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId)
    .order("phaseNumber");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    phaseNumber: Number(row.phaseNumber),
    instructions: row.instructions ?? "",
    methodOperationId: row.methodOperationId
  }));
}

export async function upsertSkuuFormulaPhase(
  client: SkuuClient,
  args: {
    makeMethodId: string;
    companyId: string;
    userId: string;
    phaseNumber: number;
    instructions: string;
    methodOperationId?: string | null;
  }
) {
  const now = new Date().toISOString();
  return client.from("skuuFormulaPhase").upsert(
    {
      makeMethodId: args.makeMethodId,
      companyId: args.companyId,
      phaseNumber: args.phaseNumber,
      instructions: args.instructions,
      methodOperationId: args.methodOperationId ?? null,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: now
    },
    { onConflict: "makeMethodId,phaseNumber" }
  );
}

export async function loadSkuuFormulationMaterials(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
): Promise<SkuuFormulationMaterialLine[]> {
  const { data: materials, error: matErr } = await client
    .from("methodMaterial")
    .select("id, itemId, itemType, order")
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId)
    .order("order");
  if (matErr) throw new Error(matErr.message);
  const ids = (materials ?? []).map((m) => m.id);
  if (!ids.length) return [];

  const itemIds = [
    ...new Set((materials ?? []).map((m) => m.itemId).filter(Boolean))
  ];
  const { data: items } = await client
    .from("item")
    .select("id, readableId, name, type")
    .eq("companyId", companyId)
    .in("id", itemIds);
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));

  const { data: formulas } = await client
    .from("skuuMethodMaterialFormula")
    .select("methodMaterialId, percentWw, phaseNumber, lineKind")
    .eq("companyId", companyId)
    .in("methodMaterialId", ids);

  const formulaByMm = new Map(
    (formulas ?? []).map((f) => [f.methodMaterialId, f])
  );

  return (materials ?? []).map((mm) => {
    const item = itemById.get(mm.itemId);
    const f = formulaByMm.get(mm.id);
    return {
      methodMaterialId: mm.id,
      itemId: mm.itemId,
      itemReadableId: item?.readableId ?? null,
      itemName: item?.name ?? null,
      itemType: mm.itemType ?? item?.type ?? "Material",
      percentWw: f?.percentWw != null ? Number(f.percentWw) : null,
      phaseNumber: f?.phaseNumber != null ? Number(f.phaseNumber) : 1,
      lineKind: f?.lineKind ?? "ingredient"
    };
  });
}

export async function loadSkuuFormulationView(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
) {
  const [profile, phases, materials] = await Promise.all([
    loadSkuuBulkProfile(client, makeMethodId, companyId),
    loadSkuuFormulaPhases(client, makeMethodId, companyId),
    loadSkuuFormulationMaterials(client, makeMethodId, companyId)
  ]);
  const { mergeSkuuFormulaPhases } = await import("./skuu-phased-formula");
  return {
    profile,
    phases: mergeSkuuFormulaPhases(phases, materials),
    materials
  };
}
