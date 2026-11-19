// SPDX-License-Identifier: AGPL-3.0-only
// SkuuOS bulk formula persistence (AGPL extension).

import type { Database } from "@carbon/database";
import { type PercentLine, validatePercentSum } from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SkuuBulkProfile = {
  enabled: boolean;
  batchBasisKg: number;
  /** @deprecated Prefer expectedYieldPercent */
  yieldLossPercent: number;
  productDensityGPerMl: number | null;
  expectedYieldPercent: number;
};

type SkuuClient = SupabaseClient<Database> & {
  from: SupabaseClient<Database>["from"];
};

export async function loadSkuuBulkProfile(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
): Promise<SkuuBulkProfile | null> {
  const { data, error } = await client
    .from("skuuMakeMethodBulk")
    .select(
      "enabled, batchBasisKg, yieldLossPercent, productDensityGPerMl, expectedYieldPercent"
    )
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    enabled: data.enabled,
    batchBasisKg: Number(data.batchBasisKg),
    yieldLossPercent: Number(data.yieldLossPercent ?? 0),
    productDensityGPerMl:
      data.productDensityGPerMl == null
        ? null
        : Number(data.productDensityGPerMl),
    expectedYieldPercent: Number(data.expectedYieldPercent ?? 100)
  };
}

export async function loadSkuuFormulaPercents(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
): Promise<Map<string, number>> {
  const { data: materials } = await client
    .from("methodMaterial")
    .select("id")
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId);
  const ids = (materials ?? []).map((m) => m.id);
  if (!ids.length) return new Map();
  const { data: formulas } = await client
    .from("skuuMethodMaterialFormula")
    .select("methodMaterialId, percentWw")
    .eq("companyId", companyId)
    .in("methodMaterialId", ids);
  const map = new Map<string, number>();
  for (const row of formulas ?? []) {
    if (row.percentWw != null) {
      map.set(row.methodMaterialId, Number(row.percentWw));
    }
  }
  return map;
}

export async function assertSkuuBulkFormulaValid(
  client: SkuuClient,
  makeMethodId: string,
  companyId: string
): Promise<void> {
  const profile = await loadSkuuBulkProfile(client, makeMethodId, companyId);
  if (!profile?.enabled) return;
  const percents = await loadSkuuFormulaPercents(
    client,
    makeMethodId,
    companyId
  );
  const lines: PercentLine[] = [...percents.entries()].map(
    ([id, percentWw]) => ({
      id,
      percentWw
    })
  );
  const result = validatePercentSum(lines);
  if (!result.ok) {
    throw new Error(result.message ?? "Bulk formula must total 100%.");
  }
}

export async function upsertSkuuBulkProfile(
  client: SkuuClient,
  args: {
    makeMethodId: string;
    companyId: string;
    userId: string;
    profile: SkuuBulkProfile;
  }
) {
  const now = new Date().toISOString();
  return client.from("skuuMakeMethodBulk").upsert(
    {
      makeMethodId: args.makeMethodId,
      companyId: args.companyId,
      enabled: args.profile.enabled,
      batchBasisKg: args.profile.batchBasisKg,
      yieldLossPercent: args.profile.yieldLossPercent,
      productDensityGPerMl: args.profile.productDensityGPerMl,
      expectedYieldPercent: args.profile.expectedYieldPercent,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: now
    },
    { onConflict: "makeMethodId" }
  );
}

export async function upsertSkuuMaterialPercent(
  client: SkuuClient,
  args: {
    methodMaterialId: string;
    companyId: string;
    userId: string;
    percentWw: number | null;
  }
) {
  const now = new Date().toISOString();
  if (args.percentWw == null) {
    return client
      .from("skuuMethodMaterialFormula")
      .delete()
      .eq("methodMaterialId", args.methodMaterialId);
  }
  return client.from("skuuMethodMaterialFormula").upsert(
    {
      methodMaterialId: args.methodMaterialId,
      companyId: args.companyId,
      percentWw: args.percentWw,
      createdBy: args.userId,
      updatedBy: args.userId,
      updatedAt: now
    },
    { onConflict: "methodMaterialId" }
  );
}

export async function defaultRetestDateForItem(
  client: SkuuClient,
  itemId: string,
  fromDate: string
): Promise<string | null> {
  const { data } = await client
    .from("skuuItemRetest")
    .select("retestIntervalDays")
    .eq("itemId", itemId)
    .maybeSingle();
  if (!data?.retestIntervalDays) return null;
  const base = new Date(`${fromDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + data.retestIntervalDays);
  return base.toISOString().slice(0, 10);
}

export function isRetestOverdue(
  retestDate: string | null | undefined,
  todayIso: string
): boolean {
  if (!retestDate) return false;
  return retestDate < todayIso;
}
