// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

export type SkuuJobMaterialLotRef = {
  trackedEntityReadableId: string | null;
  supplierBatchNumber: string | null;
  quantityKg: number;
};

export async function loadSkuuJobMaterialLots(
  client: Client,
  companyId: string,
  jobMaterialIds: string[]
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const out = new Map<string, SkuuJobMaterialLotRef[]>();
  if (!jobMaterialIds.length) return out;

  const { data: dispenses, error } = await client
    .from("skuuJobMaterialDispense")
    .select(
      "jobMaterialId, quantityKg, supplierBatchNumber, trackedEntityId, sortOrder"
    )
    .eq("companyId", companyId)
    .in("jobMaterialId", jobMaterialIds)
    .order("sortOrder");
  if (error) throw new Error(error.message);
  if (!dispenses?.length) return out;

  const teIds = [
    ...new Set(
      dispenses.map((d) => d.trackedEntityId).filter((id): id is string => !!id)
    )
  ];
  const teReadable = new Map<string, string>();
  if (teIds.length) {
    const { data: tes } = await client
      .from("trackedEntity")
      .select("id, readableId")
      .in("id", teIds);
    for (const te of tes ?? []) {
      teReadable.set(te.id, te.readableId ?? te.id);
    }
  }

  for (const row of dispenses) {
    const list = out.get(row.jobMaterialId) ?? [];
    list.push({
      trackedEntityReadableId: row.trackedEntityId
        ? (teReadable.get(row.trackedEntityId) ?? row.trackedEntityId)
        : null,
      supplierBatchNumber: row.supplierBatchNumber,
      quantityKg: Number(row.quantityKg)
    });
    out.set(row.jobMaterialId, list);
  }
  return out;
}

export async function loadSkuuJobMaterialLotsByMethodMaterial(
  client: Client,
  companyId: string,
  jobId: string
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const { data: jm } = await client
    .from("jobMaterial")
    .select("id, jobMakeMethod(parentMaterialId)")
    .eq("jobId", jobId)
    .eq("companyId", companyId);
  if (!jm?.length) return new Map();

  const byJm = await loadSkuuJobMaterialLots(
    client,
    companyId,
    jm.map((r) => r.id)
  );
  const byMethodMaterial = new Map<string, SkuuJobMaterialLotRef[]>();
  for (const row of jm) {
    const mmId = row.jobMakeMethod?.parentMaterialId;
    if (!mmId) continue;
    const lots = byJm.get(row.id);
    if (lots?.length) byMethodMaterial.set(mmId, lots);
  }
  return byMethodMaterial;
}

/** @deprecated Prefer loadSkuuJobMaterialLotsByMethodMaterial when duplicate item lines exist. */
export async function loadSkuuJobMaterialLotsByItemReadable(
  client: Client,
  companyId: string,
  jobId: string
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const { data: jm } = await client
    .from("jobMaterial")
    .select("id, itemId")
    .eq("jobId", jobId)
    .eq("companyId", companyId);
  if (!jm?.length) return new Map();

  const { data: items } = await client
    .from("item")
    .select("id, readableId")
    .eq("companyId", companyId)
    .in(
      "id",
      jm.map((r) => r.itemId)
    );
  const readableByItem = new Map(
    (items ?? []).map((i) => [i.id, i.readableId ?? i.id])
  );

  const byJm = await loadSkuuJobMaterialLots(
    client,
    companyId,
    jm.map((r) => r.id)
  );
  const byReadable = new Map<string, SkuuJobMaterialLotRef[]>();
  for (const row of jm) {
    const code = readableByItem.get(row.itemId);
    if (!code) continue;
    const lots = byJm.get(row.id);
    if (lots?.length) byReadable.set(code, lots);
  }
  return byReadable;
}