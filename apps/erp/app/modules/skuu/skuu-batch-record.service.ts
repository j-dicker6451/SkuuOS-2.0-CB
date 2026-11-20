// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import { grossInputKg, lineKgFromPercent } from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nanoid } from "nanoid";
import {
  buildSkuuPhasedFormulaBlocks,
  mergeSkuuFormulaPhases
} from "./skuu-phased-formula";
import { loadSkuuFormulationView } from "./skuu-formulation.service";
import { resolveSkuuBulkMakeMethodForJob } from "./skuu-job-bulk.server";
import {
  loadSkuuJobMaterialLots,
  loadSkuuJobMaterialLotsFromConsumption,
  loadSkuuJobMaterialLotsFromTrackedActivity,
  type SkuuJobMaterialLotRef
} from "./skuu-job-material-lots";

type Client = SupabaseClient<Database>;

export type SkuuDispenseRow = {
  id: string;
  jobMaterialId: string;
  quantityKg: number;
  supplierBatchNumber: string | null;
  trackedEntityId: string | null;
  trackedEntityReadableId: string | null;
  markedAdded: boolean;
  addedAt: string | null;
  addedBy: string | null;
  correctionReason: string | null;
};

export type SkuuJobPhaseRecord = {
  phaseNumber: number;
  completedAt: string | null;
  completedBy: string | null;
  notes: string | null;
  locked: boolean;
  correctionReason: string | null;
};

export type SkuuBatchRecordLine = {
  jobMaterialId: string;
  phaseNumber: number;
  itemReadableId: string | null;
  itemName: string | null;
  plannedKg: number;
  percentWw: number;
  dispenses: SkuuDispenseRow[];
  /** First issued raw lot label when materials were consumed via MES. */
  issuedLotHint: string | null;
  lineComplete: boolean;
};

export type SkuuBatchRecordView = {
  jobId: string;
  phases: Array<{
    phaseNumber: number;
    instructions: string;
    locked: boolean;
    completedAt: string | null;
    notes: string | null;
    lines: SkuuBatchRecordLine[];
    phaseComplete: boolean;
  }>;
};

export async function loadSkuuBatchRecordView(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<SkuuBatchRecordView | null> {
  const resolved = await resolveSkuuBulkMakeMethodForJob(client, args);
  if (!resolved) return null;
  const { makeMethodId } = resolved;

  const { data: job } = await client
    .from("job")
    .select("id, quantity")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .single();
  if (!job) return null;

  const formulation = await loadSkuuFormulationView(
    client,
    makeMethodId,
    args.companyId
  );
  if (!formulation.profile?.enabled) return null;

  const grossKg = grossInputKg(
    Number(job.quantity),
    formulation.profile.expectedYieldPercent
  );

  const { data: jobMaterials } = await client
    .from("jobMaterial")
    .select(
      "id, itemId, estimatedQuantity, order, jobMakeMethod(parentMaterialId)"
    )
    .eq("jobId", args.jobId)
    .eq("companyId", args.companyId);

  const jobMaterialByMethodMaterial = new Map<string, (typeof jobMaterials)[0]>();
  const materialByItemId = new Map(
    formulation.materials.map((m) => [m.itemId, m.methodMaterialId])
  );
  for (const jm of jobMaterials ?? []) {
    const parentId = jm.jobMakeMethod?.parentMaterialId;
    if (parentId) {
      jobMaterialByMethodMaterial.set(parentId, jm);
      continue;
    }
    const mmId = jm.itemId ? materialByItemId.get(jm.itemId) : undefined;
    if (mmId && !jobMaterialByMethodMaterial.has(mmId)) {
      jobMaterialByMethodMaterial.set(mmId, jm);
    }
  }

  const { data: dispenseRows } = await client
    .from("skuuJobMaterialDispense")
    .select(
      "id, jobMaterialId, quantityKg, supplierBatchNumber, trackedEntityId, markedAdded, addedAt, addedBy, correctionReason"
    )
    .eq("companyId", args.companyId)
    .in(
      "jobMaterialId",
      (jobMaterials ?? []).map((jm) => jm.id)
    );

  const teIds = [
    ...new Set(
      (dispenseRows ?? [])
        .map((r) => r.trackedEntityId)
        .filter((id): id is string => !!id)
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

  const jobMaterialIds = (jobMaterials ?? []).map((jm) => jm.id);
  const dispenseLots = await loadSkuuJobMaterialLots(
    client,
    args.companyId,
    jobMaterialIds
  );
  const consumedLots = await loadSkuuJobMaterialLotsFromConsumption(
    client,
    args.companyId,
    args.jobId,
    jobMaterialIds
  );
  const activityLots = await loadSkuuJobMaterialLotsFromTrackedActivity(
    client,
    args.companyId,
    args.jobId,
    jobMaterialIds
  );
  const issuedLotsByJm = new Map<string, SkuuJobMaterialLotRef[]>();
  for (const id of jobMaterialIds) {
    const lots =
      (dispenseLots.get(id)?.length ?? 0) > 0
        ? dispenseLots.get(id)!
        : (consumedLots.get(id)?.length
            ? consumedLots.get(id)!
            : (activityLots.get(id) ?? []));
    if (lots.length) issuedLotsByJm.set(id, lots);
  }

  const dispenseByJm = new Map<string, SkuuDispenseRow[]>();
  for (const row of dispenseRows ?? []) {
    const list = dispenseByJm.get(row.jobMaterialId) ?? [];
    list.push({
      id: row.id,
      jobMaterialId: row.jobMaterialId,
      quantityKg: Number(row.quantityKg),
      supplierBatchNumber: row.supplierBatchNumber,
      trackedEntityId: row.trackedEntityId,
      trackedEntityReadableId: row.trackedEntityId
        ? (teReadable.get(row.trackedEntityId) ?? row.trackedEntityId)
        : null,
      markedAdded: row.markedAdded ?? false,
      addedAt: row.addedAt,
      addedBy: row.addedBy,
      correctionReason: row.correctionReason
    });
    dispenseByJm.set(row.jobMaterialId, list);
  }

  const { data: phaseRecords } = await client
    .from("skuuJobPhaseRecord")
    .select(
      "phaseNumber, completedAt, completedBy, notes, locked, correctionReason"
    )
    .eq("jobId", args.jobId)
    .eq("companyId", args.companyId);

  const phaseRecordByNum = new Map(
    (phaseRecords ?? []).map((r) => [r.phaseNumber, r])
  );

  const mergedPhases = mergeSkuuFormulaPhases(
    formulation.phases,
    formulation.materials
  );

  const phases = mergedPhases.map((phase) => {
    const lines: SkuuBatchRecordLine[] = [];
    const formulaLines = formulation.materials
      .filter((f) => (f.phaseNumber ?? 1) === phase.phaseNumber)
      .sort((a, b) => a.order - b.order);

    for (const formula of formulaLines) {
      const jm = jobMaterialByMethodMaterial.get(formula.methodMaterialId);
      const pct = formula.percentWw ?? 0;
      const plannedKg =
        formula.percentWw != null
          ? lineKgFromPercent(Number(formula.percentWw), grossKg)
          : Number(jm?.estimatedQuantity ?? 0);
      const dispenses = jm ? (dispenseByJm.get(jm.id) ?? []) : [];
      const issuedLots = jm ? (issuedLotsByJm.get(jm.id) ?? []) : [];
      const issuedLotHint =
        issuedLots[0]?.trackedEntityReadableId ??
        issuedLots[0]?.supplierBatchNumber ??
        null;
      const addedKg = dispenses
        .filter((d) => d.markedAdded)
        .reduce((s, d) => s + d.quantityKg, 0);
      lines.push({
        jobMaterialId: jm?.id ?? formula.methodMaterialId,
        phaseNumber: phase.phaseNumber,
        itemReadableId: formula.itemReadableId,
        itemName: formula.itemName,
        plannedKg,
        percentWw: pct,
        dispenses,
        issuedLotHint,
        lineComplete: dispenses.some((d) => d.markedAdded) && addedKg > 0
      });
    }
    const rec = phaseRecordByNum.get(phase.phaseNumber);
    const phaseComplete = Boolean(rec?.completedAt && rec.locked);
    return {
      phaseNumber: phase.phaseNumber,
      instructions: phase.instructions,
      locked: rec?.locked ?? false,
      completedAt: rec?.completedAt ?? null,
      notes: rec?.notes ?? null,
      lines,
      phaseComplete
    };
  });

  return { jobId: args.jobId, phases };
}

export async function upsertSkuuDispenseRow(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    jobMaterialId: string;
    quantityKg: number;
    supplierBatchNumber?: string | null;
    trackedEntityId?: string | null;
    id?: string;
  }
) {
  const now = new Date().toISOString();
  const payload = {
    id: args.id ?? nanoid(),
    jobMaterialId: args.jobMaterialId,
    companyId: args.companyId,
    quantityKg: args.quantityKg,
    supplierBatchNumber: args.supplierBatchNumber ?? null,
    trackedEntityId: args.trackedEntityId ?? null,
    createdBy: args.userId
  };
  return client.from("skuuJobMaterialDispense").upsert(payload, { onConflict: "id" });
}

export async function markSkuuDispenseAdded(
  client: Client,
  args: {
    companyId: string;
    userId: string;
    dispenseId: string;
    markedAdded: boolean;
    correctionReason?: string | null;
  }
) {
  const { data: existing } = await client
    .from("skuuJobMaterialDispense")
    .select("markedAdded")
    .eq("id", args.dispenseId)
    .eq("companyId", args.companyId)
    .single();

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    markedAdded: args.markedAdded
  };
  if (args.markedAdded) {
    updates.addedAt = now;
    updates.addedBy = args.userId;
  }
  if (args.correctionReason) {
    updates.correctionReason = args.correctionReason;
    updates.correctedAt = now;
    updates.correctedBy = args.userId;
  } else if (existing?.markedAdded && !args.markedAdded) {
    updates.correctionReason = args.correctionReason ?? null;
  }

  return client
    .from("skuuJobMaterialDispense")
    .update(updates)
    .eq("id", args.dispenseId)
    .eq("companyId", args.companyId);
}

export async function completeSkuuJobPhase(
  client: Client,
  args: {
    jobId: string;
    companyId: string;
    userId: string;
    phaseNumber: number;
    notes?: string;
    correctionReason?: string;
  }
) {
  const now = new Date().toISOString();
  const { data: existing } = await client
    .from("skuuJobPhaseRecord")
    .select("locked")
    .eq("jobId", args.jobId)
    .eq("phaseNumber", args.phaseNumber)
    .maybeSingle();

  if (existing?.locked && !args.correctionReason) {
    throw new Error("Phase is locked; provide a correction reason to update.");
  }

  const unlocking = Boolean(existing?.locked && args.correctionReason);

  return client.from("skuuJobPhaseRecord").upsert(
    {
      jobId: args.jobId,
      phaseNumber: args.phaseNumber,
      companyId: args.companyId,
      completedAt: now,
      completedBy: args.userId,
      notes: args.notes ?? null,
      locked: unlocking ? false : true,
      correctionReason: args.correctionReason ?? null,
      correctedAt: args.correctionReason ? now : null,
      correctedBy: args.correctionReason ? args.userId : null,
      updatedAt: now
    },
    { onConflict: "jobId,phaseNumber" }
  );
}