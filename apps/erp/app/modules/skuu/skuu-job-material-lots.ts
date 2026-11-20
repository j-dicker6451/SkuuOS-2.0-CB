// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSkuuBulkMakeMethodForJob } from "./skuu-job-bulk.server";

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

/** MES issue / consumption rows when manual dispense rows were not created. */
export async function loadSkuuJobMaterialLotsFromConsumption(
  client: Client,
  companyId: string,
  jobId: string,
  jobMaterialIds: string[]
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const out = new Map<string, SkuuJobMaterialLotRef[]>();
  if (!jobMaterialIds.length) return out;

  const { data: materials } = await client
    .from("jobMaterial")
    .select("id, itemId, quantityIssued")
    .eq("companyId", companyId)
    .in("id", jobMaterialIds);
  const issuedByItem = new Map<string, string[]>();
  for (const jm of materials ?? []) {
    if (Number(jm.quantityIssued ?? 0) <= 0) continue;
    const list = issuedByItem.get(jm.itemId) ?? [];
    list.push(jm.id);
    issuedByItem.set(jm.itemId, list);
  }
  if (issuedByItem.size === 0) return out;

  const { data: ledger, error: ledgerErr } = await client
    .from("itemLedger")
    .select("itemId, trackedEntityId, quantity")
    .eq("companyId", companyId)
    .eq("documentId", jobId)
    .eq("entryType", "Consumption")
    .not("trackedEntityId", "is", null);
  if (ledgerErr) throw new Error(ledgerErr.message);

  const ledgerRows = ledger ?? [];

  const teIds = [
    ...new Set(
      (ledger ?? [])
        .map((r) => r.trackedEntityId)
        .filter((id): id is string => !!id)
    )
  ];
  const teMeta = new Map<
    string,
    { readableId: string; supplierBatch: string | null }
  >();
  if (teIds.length) {
    const { data: tes } = await client
      .from("trackedEntity")
      .select("id, readableId, sourceDocumentReadableId")
      .in("id", teIds);
    for (const te of tes ?? []) {
      teMeta.set(te.id, {
        readableId: te.readableId ?? te.id,
        supplierBatch: te.sourceDocumentReadableId ?? te.readableId ?? null
      });
    }
  }

  const qtyByItemTe = new Map<string, Map<string, number>>();
  for (const row of ledgerRows) {
    if (!row.trackedEntityId || !row.itemId) continue;
    const qty = Math.max(0, -Number(row.quantity ?? 0));
    if (qty <= 0) continue;
    const byTe = qtyByItemTe.get(row.itemId) ?? new Map<string, number>();
    byTe.set(
      row.trackedEntityId,
      (byTe.get(row.trackedEntityId) ?? 0) + qty
    );
    qtyByItemTe.set(row.itemId, byTe);
  }

  for (const [itemId, jmIds] of issuedByItem) {
    const byTe = qtyByItemTe.get(itemId);
    if (!byTe?.size) continue;
    const lots: SkuuJobMaterialLotRef[] = [...byTe.entries()].map(
      ([teId, quantityKg]) => {
        const meta = teMeta.get(teId);
        return {
          trackedEntityReadableId: meta?.readableId ?? teId,
          supplierBatchNumber: meta?.supplierBatch ?? null,
          quantityKg
        };
      }
    );
    for (const jmId of jmIds) {
      out.set(jmId, lots);
    }
  }
  return out;
}

/** MES consume activities (itemLedger may be inventory-gated for production viewers). */
export async function loadSkuuJobMaterialLotsFromTrackedActivity(
  client: Client,
  companyId: string,
  _jobId: string,
  jobMaterialIds: string[] = []
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const out = new Map<string, SkuuJobMaterialLotRef[]>();
  if (!jobMaterialIds.length) return out;

  let activityQuery = client
    .from("trackedActivity")
    .select(
      "sourceDocumentId, trackedActivityInput(trackedEntityId, quantity)"
    )
    .eq("companyId", companyId)
    .eq("type", "Consume")
    .eq("sourceDocument", "Job Material")
    .in("sourceDocumentId", jobMaterialIds);
  const { data: activities, error } = await activityQuery;
  if (error) throw new Error(error.message);
  if (!activities?.length) return out;

  const teIds = [
    ...new Set(
      activities.flatMap((a) =>
        (a.trackedActivityInput ?? [])
          .map((i) => i.trackedEntityId)
          .filter((id): id is string => !!id)
      )
    )
  ];
  const teMeta = new Map<
    string,
    { readableId: string; supplierBatch: string | null }
  >();
  if (teIds.length) {
    const { data: tes } = await client
      .from("trackedEntity")
      .select("id, readableId, sourceDocumentReadableId")
      .in("id", teIds);
    for (const te of tes ?? []) {
      teMeta.set(te.id, {
        readableId: te.readableId ?? te.id,
        supplierBatch: te.sourceDocumentReadableId ?? null
      });
    }
  }

  for (const activity of activities) {
    const jmId = activity.sourceDocumentId;
    if (!jmId) continue;
    const list = out.get(jmId) ?? [];
    for (const input of activity.trackedActivityInput ?? []) {
      if (!input.trackedEntityId) continue;
      const qty = Number(input.quantity);
      if (!(qty > 0)) continue;
      const meta = teMeta.get(input.trackedEntityId);
      const existing = list.find(
        (l) => l.trackedEntityReadableId === (meta?.readableId ?? input.trackedEntityId)
      );
      if (existing) {
        existing.quantityKg += qty;
      } else {
        list.push({
          trackedEntityReadableId: meta?.readableId ?? input.trackedEntityId,
          supplierBatchNumber: meta?.supplierBatch ?? meta?.readableId ?? null,
          quantityKg: qty
        });
      }
    }
    if (list.length) out.set(jmId, list);
  }
  return out;
}

function mergeLotMaps(
  primary: Map<string, SkuuJobMaterialLotRef[]>,
  fallback: Map<string, SkuuJobMaterialLotRef[]>
): Map<string, SkuuJobMaterialLotRef[]> {
  const merged = new Map(primary);
  for (const [key, lots] of fallback) {
    if (!merged.get(key)?.length) {
      merged.set(key, lots);
    }
  }
  return merged;
}

export async function loadSkuuJobMaterialLotsByMethodMaterial(
  client: Client,
  companyId: string,
  jobId: string
): Promise<Map<string, SkuuJobMaterialLotRef[]>> {
  const { data: jm } = await client
    .from("jobMaterial")
    .select("id, itemId, jobMakeMethod(parentMaterialId)")
    .eq("jobId", jobId)
    .eq("companyId", companyId);
  if (!jm?.length) return new Map();

  const jobMaterialIds = jm.map((r) => r.id);
  const byJm = mergeLotMaps(
    mergeLotMaps(
      await loadSkuuJobMaterialLots(client, companyId, jobMaterialIds),
      await loadSkuuJobMaterialLotsFromConsumption(
        client,
        companyId,
        jobId,
        jobMaterialIds
      )
    ),
    await loadSkuuJobMaterialLotsFromTrackedActivity(
      client,
      companyId,
      jobId,
      jobMaterialIds
    )
  );

  const methodMaterialByItemId = new Map<string, string>();
  const resolved = await resolveSkuuBulkMakeMethodForJob(client, {
    jobId,
    companyId
  });
  if (resolved) {
    const { data: methodMaterials } = await client
      .from("methodMaterial")
      .select("id, itemId")
      .eq("companyId", companyId)
      .eq("makeMethodId", resolved.makeMethodId);
    for (const m of methodMaterials ?? []) {
      methodMaterialByItemId.set(m.itemId, m.id);
    }
  }

  const byMethodMaterial = new Map<string, SkuuJobMaterialLotRef[]>();
  for (const row of jm) {
    const lots = byJm.get(row.id);
    if (!lots?.length) continue;
    const mmId =
      row.jobMakeMethod?.parentMaterialId ??
      methodMaterialByItemId.get(row.itemId);
    if (!mmId) continue;
    const prev = byMethodMaterial.get(mmId) ?? [];
    byMethodMaterial.set(mmId, [...prev, ...lots]);
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

  const byJm = mergeLotMaps(
    await loadSkuuJobMaterialLots(client, companyId, jm.map((r) => r.id)),
    await loadSkuuJobMaterialLotsFromConsumption(
      client,
      companyId,
      jobId,
      jm.map((r) => r.id)
    )
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