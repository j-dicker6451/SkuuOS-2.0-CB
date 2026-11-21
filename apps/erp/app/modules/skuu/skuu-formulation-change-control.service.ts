// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import {
  activateMethodVersion,
  createMakeMethodVersion
} from "~/modules/items/items.service";
import { copySkuuFormulationBetweenMakeMethods } from "./skuu-formulation-copy.service";
import {
  diffSkuuFormulationPercents,
  type SkuuFormulationDiffEntry,
  type SkuuFormulationLineSnapshot
} from "./skuu-formulation-diff";
import { loadSkuuBulkProfile } from "./skuu-bulk.service";
import { loadSkuuFormulationView } from "./skuu-formulation.service";

type Client = SupabaseClient<Database>;

export type SkuuFormulationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "superseded"
  | "withdrawn";

export const SKUU_EDITABLE_FORMULATION_STATUSES: SkuuFormulationStatus[] = [
  "draft"
];

export class SkuuFormulationLockedError extends Error {
  constructor(
    public readonly status: SkuuFormulationStatus,
    message?: string
  ) {
    super(message ?? `Formulation is ${status} and cannot be edited.`);
    this.name = "SkuuFormulationLockedError";
  }
}

export type SkuuFormulationRevisionRow = {
  makeMethodId: string;
  companyId: string;
  itemId: string;
  version: number;
  status: SkuuFormulationStatus;
  changeReason: string;
  sourceMakeMethodId: string | null;
  createdAt: string;
  createdBy: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  withdrawnAt: string | null;
  withdrawnBy: string | null;
};

export async function loadSkuuFormulationRevision(
  client: Client,
  makeMethodId: string,
  companyId: string
): Promise<SkuuFormulationRevisionRow | null> {
  const { data, error } = await client
    .from("skuuFormulationRevision")
    .select(
      "makeMethodId, companyId, itemId, version, status, changeReason, sourceMakeMethodId, createdAt, createdBy, submittedAt, submittedBy, approvedAt, approvedBy, withdrawnAt, withdrawnBy"
    )
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...data,
    version: Number(data.version),
    status: data.status as SkuuFormulationStatus
  };
}

export async function resolveSkuuFormulationStatus(
  client: Client,
  makeMethodId: string,
  companyId: string
): Promise<SkuuFormulationStatus> {
  const [revision, method] = await Promise.all([
    loadSkuuFormulationRevision(client, makeMethodId, companyId),
    client
      .from("makeMethod")
      .select("status")
      .eq("id", makeMethodId)
      .eq("companyId", companyId)
      .maybeSingle()
  ]);
  if (revision) return revision.status;
  if (method.data?.status === "Active") return "approved";
  if (method.data?.status === "Archived") return "superseded";
  return "draft";
}

export async function assertSkuuFormulationEditable(
  client: Client,
  makeMethodId: string,
  companyId: string
): Promise<void> {
  const profile = await loadSkuuBulkProfile(client, makeMethodId, companyId);
  if (!profile?.enabled) return;

  const status = await resolveSkuuFormulationStatus(
    client,
    makeMethodId,
    companyId
  );
  if (!SKUU_EDITABLE_FORMULATION_STATUSES.includes(status)) {
    throw new SkuuFormulationLockedError(status);
  }
}

export async function assertMakeMethodSkuuEditable(
  client: Client,
  makeMethodId: string,
  companyId: string
): Promise<void> {
  await assertSkuuFormulationEditable(client, makeMethodId, companyId);
}

async function nextMakeMethodVersion(
  client: Client,
  itemId: string,
  companyId: string
): Promise<number> {
  const { data } = await client
    .from("makeMethod")
    .select("version")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  const max = Math.max(0, ...(data ?? []).map((r) => Number(r.version)));
  return Math.round((max + 0.01) * 100) / 100;
}

export async function listSkuuFormulationRevisionsForItem(
  client: Client,
  itemId: string,
  companyId: string
): Promise<SkuuFormulationRevisionRow[]> {
  const { data, error } = await client
    .from("skuuFormulationRevision")
    .select(
      "makeMethodId, companyId, itemId, version, status, changeReason, sourceMakeMethodId, createdAt, createdBy, submittedAt, submittedBy, approvedAt, approvedBy, withdrawnAt, withdrawnBy"
    )
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...row,
    version: Number(row.version),
    status: row.status as SkuuFormulationStatus
  }));
}

function toLineSnapshots(
  materials: Awaited<
    ReturnType<typeof loadSkuuFormulationView>
  >["materials"]
): SkuuFormulationLineSnapshot[] {
  return materials.map((m) => ({
    methodMaterialId: m.methodMaterialId,
    itemReadableId: m.itemReadableId,
    percentWw: m.percentWw,
    phaseNumber: m.phaseNumber
  }));
}

export async function computeSkuuFormulationDiff(
  client: Client,
  sourceMakeMethodId: string,
  targetMakeMethodId: string,
  companyId: string
): Promise<SkuuFormulationDiffEntry[]> {
  const [src, tgt] = await Promise.all([
    loadSkuuFormulationView(client, sourceMakeMethodId, companyId),
    loadSkuuFormulationView(client, targetMakeMethodId, companyId)
  ]);
  return diffSkuuFormulationPercents(
    toLineSnapshots(src.materials),
    toLineSnapshots(tgt.materials)
  );
}

export async function findApprovedSkuuFormulationMakeMethod(
  client: Client,
  itemId: string,
  companyId: string
): Promise<{ makeMethodId: string; version: number } | null> {
  const { data: revisions } = await client
    .from("skuuFormulationRevision")
    .select("makeMethodId, version, status")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "approved")
    .order("version", { ascending: false })
    .limit(1);
  if (revisions?.[0]) {
    return {
      makeMethodId: revisions[0].makeMethodId,
      version: Number(revisions[0].version)
    };
  }

  const { data: active } = await client
    .from("makeMethod")
    .select("id, version")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Active")
    .maybeSingle();
  if (!active?.id) return null;

  const bulk = await loadSkuuBulkProfile(client, active.id, companyId);
  if (!bulk?.enabled) return null;
  return { makeMethodId: active.id, version: Number(active.version) };
}

export async function itemUsesSkuuBulkFormulation(
  client: Client,
  itemId: string,
  companyId: string
): Promise<boolean> {
  const { data: methods, error: mmErr } = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId);
  if (mmErr) throw new Error(mmErr.message);
  const ids = (methods ?? []).map((m) => m.id);
  if (!ids.length) return false;
  const { count, error } = await client
    .from("skuuMakeMethodBulk")
    .select("makeMethodId", { count: "exact", head: true })
    .eq("companyId", companyId)
    .eq("enabled", true)
    .in("makeMethodId", ids);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export function evaluateSkuuFormulationJobGate(args: {
  usesSkuuBulk: boolean;
  approved: { makeMethodId: string; version: number } | null;
  approvedStatus: SkuuFormulationStatus | null;
}):
  | { ok: true; skuuBulk: false }
  | { ok: true; skuuBulk: true; makeMethodId: string; version: number }
  | { ok: false; message: string } {
  if (!args.usesSkuuBulk) return { ok: true, skuuBulk: false };
  if (!args.approved) {
    return {
      ok: false,
      message:
        "Production jobs for this bulk part require an approved Skuu formulation version."
    };
  }
  if (args.approvedStatus !== "approved") {
    return {
      ok: false,
      message: `Formulation version is ${args.approvedStatus}; only approved versions can release jobs.`
    };
  }
  return {
    ok: true,
    skuuBulk: true,
    makeMethodId: args.approved.makeMethodId,
    version: args.approved.version
  };
}

export async function validateSkuuFormulationApprovedForNewJob(
  client: Client,
  itemId: string,
  companyId: string
): Promise<
  | { ok: true; skuuBulk: false }
  | { ok: true; skuuBulk: true; makeMethodId: string; version: number }
  | { ok: false; message: string }
> {
  const usesSkuu = await itemUsesSkuuBulkFormulation(client, itemId, companyId);
  const approved = usesSkuu
    ? await findApprovedSkuuFormulationMakeMethod(client, itemId, companyId)
    : null;
  const approvedStatus = approved
    ? await resolveSkuuFormulationStatus(
        client,
        approved.makeMethodId,
        companyId
      )
    : null;
  return evaluateSkuuFormulationJobGate({
    usesSkuuBulk: usesSkuu,
    approved,
    approvedStatus
  });
}

export async function createSkuuFormulationVersion(
  client: Client,
  db: Kysely<KyselyDatabase>,
  args: {
    sourceMakeMethodId: string;
    changeReason: string;
    companyId: string;
    userId: string;
  }
): Promise<{ makeMethodId: string; version: number } | { error: string }> {
  const reason = args.changeReason.trim();
  if (!reason) return { error: "A reason for the formulation change is required." };

  const sourceStatus = await resolveSkuuFormulationStatus(
    client,
    args.sourceMakeMethodId,
    args.companyId
  );
  if (sourceStatus !== "approved") {
    return { error: "Only an approved formulation can be cloned into a new version." };
  }

  const { data: sourceMethod } = await client
    .from("makeMethod")
    .select("itemId, version")
    .eq("id", args.sourceMakeMethodId)
    .eq("companyId", args.companyId)
    .single();
  if (!sourceMethod?.itemId) return { error: "Source make method not found." };

  const nextVersion = await nextMakeMethodVersion(
    client,
    sourceMethod.itemId,
    args.companyId
  );

  const created = await createMakeMethodVersion(client, db, {
    copyFromId: args.sourceMakeMethodId,
    version: nextVersion,
    companyId: args.companyId,
    createdBy: args.userId
  });
  if (created.error || !created.data) {
    return { error: created.error?.message ?? "Could not create method version." };
  }

  const copy = await copySkuuFormulationBetweenMakeMethods(client, {
    sourceMakeMethodId: args.sourceMakeMethodId,
    targetMakeMethodId: created.data.id,
    companyId: args.companyId,
    userId: args.userId
  });
  if (copy.error) return { error: copy.error };

  const now = new Date().toISOString();
  const { error: revErr } = await client.from("skuuFormulationRevision").insert({
    makeMethodId: created.data.id,
    companyId: args.companyId,
    itemId: sourceMethod.itemId,
    version: nextVersion,
    status: "draft",
    changeReason: reason,
    sourceMakeMethodId: args.sourceMakeMethodId,
    createdBy: args.userId,
    updatedBy: args.userId,
    updatedAt: now
  });
  if (revErr) return { error: revErr.message };

  return { makeMethodId: created.data.id, version: nextVersion };
}

export async function submitSkuuFormulationForApproval(
  client: Client,
  makeMethodId: string,
  companyId: string,
  userId: string
): Promise<{ error: string | null }> {
  const status = await resolveSkuuFormulationStatus(
    client,
    makeMethodId,
    companyId
  );
  if (status !== "draft") {
    return { error: `Only draft versions can be submitted (${status}).` };
  }

  const now = new Date().toISOString();
  const { error } = await client
    .from("skuuFormulationRevision")
    .update({
      status: "pending_approval",
      submittedAt: now,
      submittedBy: userId,
      updatedAt: now,
      updatedBy: userId
    })
    .eq("makeMethodId", makeMethodId)
    .eq("companyId", companyId)
    .eq("status", "draft");
  return { error: error?.message ?? null };
}

export async function approveSkuuFormulationVersion(
  client: Client,
  db: Kysely<KyselyDatabase>,
  args: {
    makeMethodId: string;
    companyId: string;
    approverUserId: string;
    requireDifferentApprover?: boolean;
  }
): Promise<{ error: string | null }> {
  const revision = await loadSkuuFormulationRevision(
    client,
    args.makeMethodId,
    args.companyId
  );
  if (!revision) return { error: "Formulation revision record not found." };
  if (revision.status !== "pending_approval" && revision.status !== "draft") {
    return { error: `Cannot approve formulation in status ${revision.status}.` };
  }

  if (
    args.requireDifferentApprover !== false &&
    revision.createdBy === args.approverUserId
  ) {
    return {
      error: "Approver must be a different user than the author of this version."
    };
  }

  const activated = await activateMethodVersion(client, db, {
    id: args.makeMethodId,
    companyId: args.companyId,
    userId: args.approverUserId
  });
  if (activated.error) {
    return { error: activated.error.message };
  }

  const now = new Date().toISOString();

  const { data: priorApproved } = await client
    .from("skuuFormulationRevision")
    .select("makeMethodId")
    .eq("itemId", revision.itemId)
    .eq("companyId", args.companyId)
    .eq("status", "approved");

  if (priorApproved?.length) {
    await client
      .from("skuuFormulationRevision")
      .update({
        status: "superseded",
        updatedAt: now,
        updatedBy: args.approverUserId
      })
      .eq("itemId", revision.itemId)
      .eq("companyId", args.companyId)
      .eq("status", "approved")
      .neq("makeMethodId", args.makeMethodId);
  }

  const { error: updErr } = await client
    .from("skuuFormulationRevision")
    .update({
      status: "approved",
      approvedAt: now,
      approvedBy: args.approverUserId,
      updatedAt: now,
      updatedBy: args.approverUserId
    })
    .eq("makeMethodId", args.makeMethodId)
    .eq("companyId", args.companyId);

  return { error: updErr?.message ?? null };
}