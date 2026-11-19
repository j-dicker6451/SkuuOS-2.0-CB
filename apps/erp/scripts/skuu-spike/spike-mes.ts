// SPDX-License-Identifier: AGPL-3.0-only

import { sql, type Kysely } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";
import { equals, round } from "@carbon/database/precision";
import { manufactureFromExpectedYield } from "@skuu/formula";
import { issueMaterial } from "~/modules/inventory/inventory.service";
import { invokePosting } from "~/modules/shared/shared.service";
import {
  loadSkuuBulkProfile,
  upsertSkuuBulkProfile,
  upsertSkuuMaterialPercent
} from "~/modules/skuu/skuu-bulk.service";
import { recalculateJobRequirements } from "~/modules/production/production.service";
import { handlesOf } from "../../test/database/fixtures/handles";
import { unwrap } from "./posting-helpers";
import type { SpikeContext, SpikeInput } from "./context";

type Db = Kysely<KyselyDatabase>;

const QTY_EPS = 1e-5;

export type SpikeLot = { id: string; quantity: number };

/**
 * Greedy allocation: prefer smaller lots first so full consumes happen before
 * partial splits (Carbon: drawQuantity must be below parent qty on a split).
 */
export function allocateTrackedIssueDraws(
  lots: SpikeLot[],
  toIssue: number
): { trackedEntityId: string; quantity: number }[] {
  if (toIssue <= QTY_EPS) return [];
  if (lots.length === 0) {
    throw new Error("No input lots to issue");
  }

  let remaining = round(toIssue);
  const ordered = [...lots].sort((a, b) => a.quantity - b.quantity);
  const children: { trackedEntityId: string; quantity: number }[] = [];

  for (const lot of ordered) {
    if (remaining <= QTY_EPS) break;
    const available = round(lot.quantity);
    if (available <= QTY_EPS) continue;

    const capped = round(Math.min(available, remaining));
    if (capped <= QTY_EPS) continue;

    const quantity = equals(capped, available) ? available : capped;
    children.push({ trackedEntityId: lot.id, quantity });
    remaining = round(remaining - quantity);
  }

  if (remaining > QTY_EPS) {
    throw new Error(
      `Insufficient lot quantity: need ${round(toIssue)}, short ${remaining}`
    );
  }

  const sum = round(children.reduce((acc, c) => acc + c.quantity, 0));
  if (!equals(sum, round(toIssue))) {
    throw new Error(
      `Lot draws sum ${sum} does not match job material requirement ${round(toIssue)}`
    );
  }

  return children;
}

/** Job output lot seeded on job insert — Reserved until MES batch complete (produceBatchOutput). */
export async function resolveJobOutputTrackedEntity(
  db: Db,
  companyId: string,
  jobId: string,
  itemId: string
) {
  const rootMakeMethod = await db
    .selectFrom("jobMakeMethod")
    .select("id")
    .where("jobId", "=", jobId)
    .where("companyId", "=", companyId)
    .where("parentMaterialId", "is", null)
    .executeTakeFirst();
  if (!rootMakeMethod) {
    throw new Error(`Root jobMakeMethod missing for job ${jobId}`);
  }

  const byAttribute = await db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity", "status"])
    .where("companyId", "=", companyId)
    .where("itemId", "=", itemId)
    .where(sql`attributes->>'Job Make Method'`, "=", rootMakeMethod.id)
    .executeTakeFirst();
  if (byAttribute) return byAttribute;

  const ledger = await db
    .selectFrom("itemLedger")
    .select("trackedEntityId")
    .where("companyId", "=", companyId)
    .where("itemId", "=", itemId)
    .where("documentId", "=", jobId)
    .where("entryType", "=", "Assembly Output")
    .where("trackedEntityId", "is not", null)
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!ledger?.trackedEntityId) return null;

  return db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity", "status"])
    .where("companyId", "=", companyId)
    .where("id", "=", ledger.trackedEntityId)
    .executeTakeFirst();
}

export async function syncSkuuBulkToPostgrest(
  ctx: SpikeContext,
  makeMethodId: string,
  input: SpikeInput,
  methodMaterialIds: { methodMaterialId: string; percentWw: number }[]
) {
  const client = ctx.service.asSystem.supabase;
  const { error: profileErr } = await upsertSkuuBulkProfile(client, {
    makeMethodId,
    companyId: ctx.companyId,
    userId: ctx.userId,
    profile: {
      enabled: true,
      batchBasisKg: 1,
      yieldLossPercent: 0,
      productDensityGPerMl: input.productDensityGPerMl,
      expectedYieldPercent: input.expectedYieldPercent
    }
  });
  if (profileErr) {
    throw new Error(`upsertSkuuBulkProfile: ${profileErr.message}`);
  }
  for (const row of methodMaterialIds) {
    const { error } = await upsertSkuuMaterialPercent(client, {
      methodMaterialId: row.methodMaterialId,
      companyId: ctx.companyId,
      userId: ctx.userId,
      percentWw: row.percentWw
    });
    if (error) {
      throw new Error(
        `upsertSkuuMaterialPercent ${row.methodMaterialId}: ${error.message}`
      );
    }
  }
}

export async function assertJobMaterialsGross(
  ctx: SpikeContext,
  jobId: string,
  batchKg: number,
  expectedYieldPercent: number,
  makeMethodId: string
): Promise<{ grossKg: number; sumEstimated: number }> {
  const grossKg = manufactureFromExpectedYield(batchKg, expectedYieldPercent);
  const client = ctx.service.asSystem.supabase;
  let profile = await loadSkuuBulkProfile(
    client,
    makeMethodId,
    ctx.companyId
  );
  if (!profile?.enabled) {
    throw new Error(
      `Skuu bulk profile not enabled on makeMethod ${makeMethodId} — PostgREST must see skuuMakeMethodBulk for recalculate`
    );
  }

  const materials = await ctx.db
    .selectFrom("jobMaterial")
    .select(["estimatedQuantity", "quantity"])
    .where("jobId", "=", jobId)
    .where("companyId", "=", ctx.companyId)
  .where("itemType", "in", ["Part", "Material", "Consumable"])
    .execute();

  let sumEstimated = materials.reduce(
    (acc, row) => acc + Number(row.estimatedQuantity ?? row.quantity ?? 0),
    0
  );
  const tolerance = 0.05;
  if (Math.abs(sumEstimated - grossKg) > tolerance) {
    await recalculateJobRequirements(client, ctx.db, {
      id: jobId,
      companyId: ctx.companyId,
      userId: ctx.userId
    });
    const again = await ctx.db
      .selectFrom("jobMaterial")
      .select(["estimatedQuantity", "quantity"])
      .where("jobId", "=", jobId)
      .where("companyId", "=", ctx.companyId)
      .where("itemType", "in", ["Part", "Material", "Consumable"])
      .execute();
    sumEstimated = again.reduce(
      (acc, row) => acc + Number(row.estimatedQuantity ?? row.quantity ?? 0),
      0
    );
  }

  if (Math.abs(sumEstimated - grossKg) > tolerance) {
    throw new Error(
      `Job material gross-up mismatch: sum estimatedQuantity=${sumEstimated.toFixed(4)} kg, ` +
        `expected ${grossKg.toFixed(4)} kg (${batchKg} kg @ ${expectedYieldPercent}% yield). ` +
        "Check skuuMakeMethodBulk.enabled and formula % rows loaded by recalculate."
    );
  }
  return { grossKg, sumEstimated };
}

export function buildTrackedIssueChildren(
  lots: SpikeLot[],
  toIssue: number,
  multiLotDemo: boolean
): { trackedEntityId: string; quantity: number }[] {
  if (!multiLotDemo || lots.length < 2) {
    return allocateTrackedIssueDraws(lots.slice(0, 1), toIssue);
  }
  return allocateTrackedIssueDraws(lots, toIssue);
}

/** MES shop floor: trackedEntitiesToOperation (consume) per job material line. */
export async function issueTrackedMaterialsMes(
  ctx: SpikeContext,
  jobOperationId: string,
  parentTrackedEntityId: string,
  jobId: string,
  lotsByItem: Map<string, { id: string; quantity: number }[]>,
  multiLotItemId?: string
) {
  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const materials = await ctx.db
    .selectFrom("jobMaterial")
    .select([
      "id",
      "itemId",
      "quantity",
      "estimatedQuantity",
      "quantityToIssue",
      "requiresBatchTracking"
    ])
    .where("jobId", "=", jobId)
    .where("companyId", "=", ctx.companyId)
    .where("methodType", "=", "Pull from Inventory")
    .execute();

  for (const jm of materials) {
    if (!jm.requiresBatchTracking) {
      continue;
    }
    const lots = lotsByItem.get(jm.itemId) ?? [];
    const toIssue = Number(
      jm.quantityToIssue ?? jm.quantity ?? jm.estimatedQuantity ?? 0
    );
    if (toIssue <= 0) continue;

    const children = buildTrackedIssueChildren(
      lots,
      toIssue,
      multiLotItemId != null && jm.itemId === multiLotItemId
    );
    const result = await invokePosting(
      handles,
      "issue",
      {
        type: "trackedEntitiesToOperation",
        materialId: jm.id,
        jobOperationId,
        itemId: jm.itemId,
        parentTrackedEntityId,
        children
      },
      issueMaterial
    );
    if (result.error) {
      throw new Error(
        `trackedEntitiesToOperation (${jm.itemId}): ${result.error.message}`
      );
    }
  }
}

/** MES complete.tsx batch path: production quantity + produceBatchOutput (Reserved → Available). */
export async function reportBatchOperationCompleteMes(
  ctx: SpikeContext,
  jobOperationId: string,
  parentTrackedEntityId: string,
  quantityProduced: number
) {
  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  unwrap(
    await invokePosting(
      handles,
      "issue",
      {
        type: "jobOperationBatchComplete",
        jobOperationId,
        trackedEntityId: parentTrackedEntityId,
        quantity: quantityProduced
      },
      issueMaterial
    )
  );
}

export async function assertJobConsumptionTrace(
  db: Db,
  companyId: string,
  jobId: string
) {
  const issued = await db
    .selectFrom("jobMaterial")
    .select((eb) => eb.fn.sum<number>("quantityIssued").as("s"))
    .where("jobId", "=", jobId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  const sumIssued = Number(issued?.s ?? 0);
  if (sumIssued <= 0) {
    throw new Error(
      "No raw materials consumed (quantityIssued=0) — issue tracked lots via MES path before complete"
    );
  }
  const activities = await db
    .selectFrom("trackedActivity")
    .select("id")
    .where("companyId", "=", companyId)
    .where(sql`attributes->>'Job'`, "=", jobId)
    .limit(1)
    .execute();
  if (activities.length === 0) {
    const viaOp = await db
      .selectFrom("trackedActivity as ta")
      .innerJoin("jobOperation as jo", "jo.id", "ta.sourceDocumentId")
      .select("ta.id")
      .where("ta.companyId", "=", companyId)
      .where("ta.sourceDocument", "=", "Job Operation")
      .where("jo.jobId", "=", jobId)
      .limit(1)
      .execute();
    if (viaOp.length === 0) {
      throw new Error(
        "No trackedActivity for job — genealogy empty (need Consume/Produce via issue + batch complete)"
      );
    }
  }
}