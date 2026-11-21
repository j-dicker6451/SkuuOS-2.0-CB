// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

/** Copy Skuu rows after Carbon copyMakeMethod (methodMaterial ids differ). */
export async function copySkuuFormulationBetweenMakeMethods(
  client: Client,
  args: {
    sourceMakeMethodId: string;
    targetMakeMethodId: string;
    companyId: string;
    userId: string;
  }
): Promise<{ error: string | null }> {
  const now = new Date().toISOString();
  const { companyId, userId, sourceMakeMethodId, targetMakeMethodId } = args;

  const { data: sourceBulk } = await client
    .from("skuuMakeMethodBulk")
    .select("*")
    .eq("makeMethodId", sourceMakeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (sourceBulk) {
    const { error } = await client.from("skuuMakeMethodBulk").upsert({
      makeMethodId: targetMakeMethodId,
      companyId,
      enabled: sourceBulk.enabled,
      batchBasisKg: sourceBulk.batchBasisKg,
      yieldLossPercent: sourceBulk.yieldLossPercent,
      productDensityGPerMl: sourceBulk.productDensityGPerMl,
      expectedYieldPercent: sourceBulk.expectedYieldPercent,
      createdBy: userId,
      updatedBy: userId,
      updatedAt: now
    });
    if (error) return { error: error.message };
  }

  const { data: sourcePhases } = await client
    .from("skuuFormulaPhase")
    .select("phaseNumber, instructions, methodOperationId")
    .eq("makeMethodId", sourceMakeMethodId)
    .eq("companyId", companyId);
  if (sourcePhases?.length) {
    const { error } = await client.from("skuuFormulaPhase").upsert(
      sourcePhases.map((p) => ({
        makeMethodId: targetMakeMethodId,
        companyId,
        phaseNumber: p.phaseNumber,
        instructions: p.instructions,
        methodOperationId: p.methodOperationId,
        createdBy: userId,
        updatedBy: userId,
        updatedAt: now
      }))
    );
    if (error) return { error: error.message };
  }

  const [{ data: srcMm }, { data: tgtMm }] = await Promise.all([
    client
      .from("methodMaterial")
      .select("id, itemId, order")
      .eq("makeMethodId", sourceMakeMethodId)
      .eq("companyId", companyId),
    client
      .from("methodMaterial")
      .select("id, itemId, order")
      .eq("makeMethodId", targetMakeMethodId)
      .eq("companyId", companyId)
  ]);

  const targetByKey = new Map(
    (tgtMm ?? []).map((m) => [`${m.itemId}:${m.order}`, m.id])
  );
  const sourceMaterialIds: string[] = [];
  const targetMaterialIds: string[] = [];
  for (const sm of srcMm ?? []) {
    const targetId = targetByKey.get(`${sm.itemId}:${sm.order}`);
    if (!targetId) continue;
    sourceMaterialIds.push(sm.id);
    targetMaterialIds.push(targetId);
  }

  if (!sourceMaterialIds.length) return { error: null };

  const { data: formulas } = await client
    .from("skuuMethodMaterialFormula")
    .select(
      "methodMaterialId, percentWw, phaseNumber, lineKind, reworkPercentWw, sourceTrackedEntityId"
    )
    .eq("companyId", companyId)
    .in("methodMaterialId", sourceMaterialIds);

  const idMap = new Map(
    sourceMaterialIds.map((sid, i) => [sid, targetMaterialIds[i]!])
  );

  const rows = (formulas ?? []).map((f) => ({
    methodMaterialId: idMap.get(f.methodMaterialId)!,
    companyId,
    percentWw: f.percentWw,
    phaseNumber: (f as { phaseNumber?: number | null }).phaseNumber ?? 1,
    lineKind:
      (f as { lineKind?: string | null }).lineKind ?? ("ingredient" as const),
    reworkPercentWw: (f as { reworkPercentWw?: number | null }).reworkPercentWw,
    sourceTrackedEntityId: (f as { sourceTrackedEntityId?: string | null })
      .sourceTrackedEntityId,
    createdBy: userId,
    updatedBy: userId,
    updatedAt: now
  }));

  if (rows.length) {
    const { error } = await client.from("skuuMethodMaterialFormula").upsert(rows);
    if (error) return { error: error.message };
  }

  return { error: null };
}