// SPDX-License-Identifier: AGPL-3.0-only

import {
  lineKgFromPercent,
  manufactureFromExpectedYield,
  validatePercentSum
} from "@skuu/formula";
import { sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";
import { nanoid } from "nanoid";
import {
  postInventoryAdjustment,
  postShipment,
  issueMaterial
} from "~/modules/inventory/inventory.service";
import { invokeCreate, invokePosting } from "~/modules/shared/shared.service";
import {
  insertJob,
  recalculateJobRequirements
} from "~/modules/production/production.service";
import { handlesOf } from "../../test/database/fixtures/handles";
import { seedTrx, unwrap } from "./posting-helpers";
import type { SpikeContext, SpikeInput } from "./context";
import type { SpikeReportLine } from "./report";
import { ensureSpikeMaterial, ensureSpikePart } from "./item-factory";
import { assertSpikeRawMaterials } from "./spike-assertions";
import {
  bulkItemReadableId,
  fillItemReadableId,
  resolveIngredientPartCode
} from "./spike-codes";
import {
  allocateTrackedIssueDraws,
  assertJobConsumptionTrace,
  assertJobMaterialsGross,
  issueTrackedMaterialsMes,
  reportBatchOperationCompleteMes,
  resolveJobOutputTrackedEntity,
  syncSkuuBulkToPostgrest
} from "./spike-mes";
import { teardownTagged } from "./teardown";
import {
  assignFillLotToShipmentLine,
  ensureItemBatchSequence,
  stampJobBatchLotNumber
} from "./spike-tracking";
import {
  ensureSpikeFillMethodMaterial,
  ensureSpikeMethodMaterialId,
  ensureSpikeMethodOperation,
  ensureSpikeProcess,
} from "./spike-shared-lookups";
import {
  assertSharedRawLotCrossBulkJobs,
  assertSpikeTrace,
  formatTraceReport,
  traceActivityLineage
} from "./trace-lineage";
import type { SpikeIngredient } from "./context";

type Db = SpikeContext["db"];

async function releaseJobSpike(ctx: SpikeContext, jobId: string) {
  await ctx.db
    .updateTable("job")
    .set({ status: "Ready", updatedAt: new Date().toISOString() })
    .where("id", "=", jobId)
    .where("companyId", "=", ctx.companyId)
    .execute();
}

async function completeJobSpike(
  ctx: SpikeContext,
  jobId: string,
  quantityComplete: number
) {
  await sql`
    SELECT complete_job_to_inventory(
      ${jobId},
      ${quantityComplete}::numeric,
      NULL,
      ${ctx.locationId},
      ${ctx.companyId},
      ${ctx.userId}
    )
  `.execute(ctx.db);
}

async function runTrx<T>(
  db: Db,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    return fn(trx);
  });
}

function spikeReadableId(ctx: SpikeContext, suffix: string) {
  return `${ctx.prefix}-${suffix}`;
}

async function ensureSharedRawMaterialItems(
  ctx: SpikeContext,
  ingredients: SpikeIngredient[],
  note: (section: string, message: string) => void
): Promise<Map<string, string>> {
  const partCodeToItemId = new Map<string, string>();
  for (const ing of ingredients) {
    const partCode = resolveIngredientPartCode(ing);
    if (partCodeToItemId.has(partCode)) continue;
    const itemId = await ensureSpikeMaterial(ctx, partCode, {
      name: ing.name,
      unitOfMeasureCode: ctx.lookups.unitKg,
      unitCost: 1
    });
    partCodeToItemId.set(partCode, itemId);
    note("raw-item", `Material ${partCode} (${ing.name})`);
  }
  await assertSpikeRawMaterials(ctx, [...partCodeToItemId.values()]);
  note("raw-item", `All ${partCodeToItemId.size} raw ingredient(s) verified type Material`);
  return partCodeToItemId;
}

function ingredientItemIdsInOrder(
  ingredients: SpikeIngredient[],
  partCodeToItemId: Map<string, string>
): string[] {
  return ingredients.map((ing) => {
    const code = resolveIngredientPartCode(ing);
    const itemId = partCodeToItemId.get(code);
    if (!itemId) {
      throw new Error(`Missing shared material for partCode ${code}`);
    }
    return itemId;
  });
}

async function refreshLotQuantities(
  ctx: SpikeContext,
  lotsByItem: Map<string, { id: string; quantity: number }[]>
) {
  for (const [itemId, lots] of lotsByItem) {
    const refreshed: { id: string; quantity: number }[] = [];
    for (const lot of lots) {
      const row = await ctx.db
        .selectFrom("trackedEntity")
        .select(["id", "quantity"])
        .where("companyId", "=", ctx.companyId)
        .where("id", "=", lot.id)
        .executeTakeFirst();
      if (row) {
        refreshed.push({ id: row.id, quantity: Number(row.quantity) });
      }
    }
    lotsByItem.set(itemId, refreshed);
  }
}

async function receiveRawLotsForFormula(
  ctx: SpikeContext,
  input: Pick<SpikeInput, "batchKg" | "expectedYieldPercent">,
  ingredients: SpikeIngredient[],
  ingredientIds: string[],
  lotsByItem: Map<string, { id: string; quantity: number }[]>,
  note: (section: string, message: string) => void,
  lotTag: string
) {
  const grossKg = manufactureFromExpectedYield(
    input.batchKg,
    input.expectedYieldPercent
  );
  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i]!;
    const itemId = ingredientIds[i]!;
    const partCode = resolveIngredientPartCode(ing);
    const existing = lotsByItem.get(itemId);
    if (existing && existing.length > 0) {
      note(
        "receive",
        `Ingredient ${partCode}: reusing ${existing.length} existing lot(s) from prior bulk in run`
      );
      continue;
    }
    const need = lineKgFromPercent(ing.percentage, grossKg) * 1.05;
    const lotA = await receiveLot(
      ctx,
      itemId,
      need,
      `${ctx.prefix}-${lotTag}-${partCode}-A`
    );
    const lots = [{ id: lotA.id, quantity: Number(lotA.quantity) }];
    if (i === 0) {
      const lotB = await receiveLot(
        ctx,
        itemId,
        need * 0.4,
        `${ctx.prefix}-${lotTag}-${partCode}-B`
      );
      lots.push({ id: lotB.id, quantity: Number(lotB.quantity) });
      note(
        "receive",
        `Ingredient ${partCode}: 2 lots (${lotA.readableId}, ${lotB.readableId}) for dispense scaffold`
      );
    } else {
      note("receive", `Ingredient ${partCode}: lot ${lotA.readableId}`);
    }
    lotsByItem.set(itemId, lots);
  }
}

/** ERP default: Active makeMethod for the item; promote Draft from upsertPart if needed. */
async function resolveSpikeMakeMethodId(
  trx: Transaction<KyselyDatabase>,
  companyId: string,
  userId: string,
  itemId: string
): Promise<string> {
  const active = await trx
    .selectFrom("makeMethod")
    .select("id")
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Active")
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  if (active) return active.id;

  const draft = await trx
    .selectFrom("makeMethod")
    .select(["id", "status", "version"])
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!draft) {
    throw new Error(`makeMethod missing for item ${itemId} after upsertPart`);
  }
  const version =
    draft.version != null && Number(draft.version) > 0
      ? Number(draft.version)
      : 1;
  await trx
    .updateTable("makeMethod")
    .set({
      status: "Active",
      version,
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    })
    .where("id", "=", draft.id)
    .where("companyId", "=", companyId)
    .execute();
  return draft.id;
}

async function receiveLot(
  ctx: SpikeContext,
  itemId: string,
  quantity: number,
  lotLabel: string
) {
  // Batch positive adjustments mint a new trackedEntityId (same as the UI form);
  // readableId alone books untracked ledger rows with no trackedEntity row.
  const trackedEntityId = nanoid();
  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const result = await invokePosting(
    handles,
    "post-inventory-adjustment",
    {
      adjustmentType: "Positive Adjmt.",
      itemId,
      locationId: ctx.locationId,
      quantity,
      trackedEntityId,
      readableId: lotLabel
    },
    postInventoryAdjustment
  );
  unwrap(result);
  const lot = await ctx.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity"])
    .where("companyId", "=", ctx.companyId)
    .where("id", "=", trackedEntityId)
    .executeTakeFirst();
  if (lot) {
    return lot;
  }
  const ledgerRow = await ctx.db
    .selectFrom("itemLedger")
    .select("trackedEntityId")
    .where("companyId", "=", ctx.companyId)
    .where("itemId", "=", itemId)
    .where("entryType", "=", "Positive Adjmt.")
    .where("trackedEntityId", "is not", null)
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();
  if (ledgerRow?.trackedEntityId) {
    return ctx.db
      .selectFrom("trackedEntity")
      .select(["id", "readableId", "quantity"])
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", ledgerRow.trackedEntityId)
      .executeTakeFirstOrThrow();
  }
  throw new Error(
    `receiveLot: no trackedEntity for batch label ${lotLabel} on item ${itemId} — post-inventory-adjustment must receive trackedEntityId + readableId for Batch items`
  );
}

async function setupBulkItem(
  db: Db,
  ctx: SpikeContext,
  input: SpikeInput,
  ingredientItemIds: string[],
  bulkItemId: string
) {
  const methodKey = input.formulaRef.replace(/[^a-zA-Z0-9-_]/g, "-");
  const mixProcessName = `${input.product} mix`;
  const sharedProcessId = `skuu-process-${methodKey}-mix`;
  const formulaRows: { methodMaterialId: string; percentWw: number }[] = [];

  const { makeMethodId, processId } = await runTrx(db, async (trx) => {
    const resolvedMakeMethodId = await resolveSpikeMakeMethodId(
      trx,
      ctx.companyId,
      ctx.userId,
      bulkItemId
    );
    const processId = await ensureSpikeProcess(
      trx,
      ctx,
      mixProcessName,
      sharedProcessId
    );
    const operationId = await ensureSpikeMethodOperation(
      trx,
      ctx,
      resolvedMakeMethodId,
      processId,
      "Blend",
      `${ctx.prefix}-mop-${methodKey}`
    );

    for (let i = 0; i < input.ingredients.length; i++) {
      const ing = input.ingredients[i]!;
      const methodMaterialId = await ensureSpikeMethodMaterialId(
        trx,
        ctx,
        resolvedMakeMethodId,
        operationId,
        ingredientItemIds[i]!,
        `${ctx.prefix}-mmat-${methodKey}-${i}`
      );
      await trx
        .insertInto("skuuMethodMaterialFormula")
        .values({
          methodMaterialId,
          companyId: ctx.companyId,
          percentWw: ing.percentage,
          phaseNumber: ing.phaseNumber ?? 1,
          createdBy: ctx.userId,
          updatedBy: ctx.userId
        })
        .onConflict((oc) =>
          oc.column("methodMaterialId").doUpdateSet({
            percentWw: ing.percentage,
            phaseNumber: ing.phaseNumber ?? 1,
            updatedBy: ctx.userId,
            updatedAt: new Date().toISOString()
          })
        )
        .execute();
      formulaRows.push({ methodMaterialId, percentWw: ing.percentage });
    }

    const phaseRows =
      input.phases && input.phases.length > 0
        ? input.phases
        : [{ phaseNumber: 1, instructions: "Spike demo phase — precautions N/A." }];
    for (const phase of phaseRows) {
      await trx
        .insertInto("skuuFormulaPhase")
        .values({
          makeMethodId: resolvedMakeMethodId,
          phaseNumber: phase.phaseNumber,
          companyId: ctx.companyId,
          instructions: phase.instructions ?? "",
          createdBy: ctx.userId,
          updatedBy: ctx.userId
        })
        .onConflict((oc) =>
          oc.columns(["makeMethodId", "phaseNumber"]).doUpdateSet({
            instructions: phase.instructions ?? "",
            updatedBy: ctx.userId,
            updatedAt: new Date().toISOString()
          })
        )
        .execute();
    }
    return { makeMethodId: resolvedMakeMethodId, processId };
  });

  await syncSkuuBulkToPostgrest(ctx, makeMethodId, input, formulaRows);

  return { bulkItemId, processId, makeMethodId };
}

async function createAndRunBulkJob(
  ctx: SpikeContext,
  input: SpikeInput,
  bulkItemId: string,
  makeMethodId: string,
  lotsByItem: Map<string, { id: string; quantity: number }[]>,
  jobSuffix = "BULK"
) {
  const client = ctx.service.asSystem.supabase;
  const created = await insertJob(client, ctx.db, {
    itemId: bulkItemId,
    quantity: input.batchKg,
    unitOfMeasureCode: ctx.lookups.unitKg,
    locationId: ctx.locationId,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    jobId: `${ctx.prefix}-JOB-${jobSuffix}`
  } as never);
  if (created.error || !created.data) {
    throw new Error(`insertJob failed: ${created.error?.message ?? "unknown"}`);
  }
  const jobId = created.data.id;
  await stampJobBatchLotNumber(ctx, jobId, bulkItemId);
  await recalculateJobRequirements(client, ctx.db, {
    id: jobId,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const { grossKg, sumEstimated } = await assertJobMaterialsGross(
    ctx,
    jobId,
    input.batchKg,
    input.expectedYieldPercent,
    makeMethodId
  );

  const outputEntity = await resolveJobOutputTrackedEntity(
    ctx.db,
    ctx.companyId,
    jobId,
    bulkItemId
  );
  if (!outputEntity) {
    throw new Error(
      "Job output trackedEntity missing (expected Reserved lot from sync_insert_job_make_method)"
    );
  }

  const jobRow = await ctx.db
    .selectFrom("job")
    .select(["id", "status", "quantity"])
    .where("id", "=", jobId)
    .executeTakeFirstOrThrow();

  const materials = await ctx.db
    .selectFrom("jobMaterial")
    .innerJoin("item", "item.id", "jobMaterial.itemId")
    .select([
      "jobMaterial.id",
      "jobMaterial.quantity",
      "jobMaterial.estimatedQuantity",
      "item.readableId"
    ])
    .where("jobMaterial.jobId", "=", jobId)
    .execute();

  const materialChecks: string[] = [];
  for (const m of materials) {
    const pctRow = await ctx.db
      .selectFrom("jobMaterial as jm")
      .innerJoin("methodMaterial as mm", (join) =>
        join
          .onRef("mm.makeMethodId", "=", "jm.jobMakeMethodId")
          .onRef("mm.itemId", "=", "jm.itemId")
      )
      .innerJoin(
        "skuuMethodMaterialFormula as f",
        "f.methodMaterialId",
        "mm.id"
      )
      .select(["f.percentWw", "jm.quantity", "jm.estimatedQuantity"])
      .where("jm.id", "=", m.id)
      .executeTakeFirst();
    if (pctRow?.percentWw != null) {
      const expected = lineKgFromPercent(
        Number(pctRow.percentWw),
        grossKg
      );
      materialChecks.push(
        `${m.readableId}: planned ${Number(m.quantity).toFixed(4)} kg (expected ~${expected.toFixed(4)} from %×${grossKg.toFixed(4)} gross)`
      );
    }
  }
  materialChecks.push(
    `yield gross-up: jobMaterial estimatedQuantity sum ${sumEstimated.toFixed(4)} kg (target ${grossKg.toFixed(4)} kg)`
  );

  await releaseJobSpike(ctx, jobId);

  const operation = await ctx.db
    .selectFrom("jobOperation")
    .select("id")
    .where("jobId", "=", jobId)
    .orderBy("id")
    .limit(1)
    .executeTakeFirstOrThrow();

  const multiLotItemId = [...lotsByItem.entries()].find(
    ([, lots]) => lots.length > 1
  )?.[0];

  const jobMat0 =
    multiLotItemId != null
      ? await ctx.db
          .selectFrom("jobMaterial")
          .select(["id", "quantity", "estimatedQuantity", "quantityToIssue"])
          .where("jobId", "=", jobId)
          .where("itemId", "=", multiLotItemId)
          .executeTakeFirst()
      : null;
  if (jobMat0 && multiLotItemId) {
    const lots = lotsByItem.get(multiLotItemId) ?? [];
    if (lots.length >= 2) {
      const toIssue = Number(
        jobMat0.quantityToIssue ??
          jobMat0.estimatedQuantity ??
          jobMat0.quantity ??
          0
      );
      const draws = allocateTrackedIssueDraws(lots, toIssue);
      await ctx.db
        .insertInto("skuuJobMaterialDispense")
        .values(
          draws.map((draw, sortOrder) => ({
            id: nanoid(),
            jobMaterialId: jobMat0.id,
            companyId: ctx.companyId,
            trackedEntityId: draw.trackedEntityId,
            quantityKg: draw.quantity,
            supplierBatchNumber: `${draw.trackedEntityId}-lot`,
            sortOrder,
            createdBy: ctx.userId
          }))
        )
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }
  }

  await issueTrackedMaterialsMes(
    ctx,
    operation.id,
    outputEntity.id,
    jobId,
    lotsByItem,
    multiLotItemId
  );

  await reportBatchOperationCompleteMes(
    ctx,
    operation.id,
    outputEntity.id,
    input.batchKg
  );

  await completeJobSpike(ctx, jobId, input.batchKg);
  await assertJobConsumptionTrace(ctx.db, ctx.companyId, jobId);

  const bulkLot =
    (await resolveJobOutputTrackedEntity(
      ctx.db,
      ctx.companyId,
      jobId,
      bulkItemId
    )) ?? null;

  return {
    jobId,
    jobRow,
    materialChecks,
    bulkLot: bulkLot
      ? {
          id: bulkLot.id,
          readableId: bulkLot.readableId,
          quantity: bulkLot.quantity
        }
      : null,
    grossKg,
    operationId: operation.id,
    outputStatus: bulkLot?.status ?? outputEntity.status
  };
}

async function setupFillItem(
  db: Db,
  ctx: SpikeContext,
  key: string,
  packSizeMl: number,
  bulkItemId: string,
  density: number,
  fillItemId: string
) {
  const kgPerUnit = (packSizeMl * density) / 1000;
  await runTrx(db, async (trx) => {
    const makeMethodId = await resolveSpikeMakeMethodId(
      trx,
      ctx.companyId,
      ctx.userId,
      fillItemId
    );
    const fillName = `Fill ${packSizeMl}mL`;
    const processId = await ensureSpikeProcess(
      trx,
      ctx,
      fillName,
      `skuu-process-fill-${key}-${packSizeMl}ml`
    );
    const opId = await ensureSpikeMethodOperation(
      trx,
      ctx,
      makeMethodId,
      processId,
      "Fill",
      `${ctx.prefix}-fop-${key}`
    );
    await ensureSpikeFillMethodMaterial(
      trx,
      ctx,
      makeMethodId,
      opId,
      bulkItemId,
      kgPerUnit,
      `${ctx.prefix}-fmat-${key}`
    );
  });
  return { fillItemId, kgPerUnit };
}

async function runFillJob(
  ctx: SpikeContext,
  fillItemId: string,
  units: number,
  bulkLotId: string,
  kgPerUnit: number,
  label: string
) {
  const client = ctx.service.asSystem.supabase;
  const created = await insertJob(client, ctx.db, {
    itemId: fillItemId,
    quantity: units,
    unitOfMeasureCode: ctx.lookups.unitEa,
    locationId: ctx.locationId,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    jobId: `${ctx.prefix}-JOB-${label}`
  } as never);
  unwrap({ data: created.data, error: created.error });
  const jobId = created.data!.id;
  await stampJobBatchLotNumber(ctx, jobId, fillItemId);
  await recalculateJobRequirements(client, ctx.db, {
    id: jobId,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  await releaseJobSpike(ctx, jobId);

  const operation = await ctx.db
    .selectFrom("jobOperation")
    .select("id")
    .where("jobId", "=", jobId)
    .limit(1)
    .executeTakeFirstOrThrow();

  const outputEntity = await resolveJobOutputTrackedEntity(
    ctx.db,
    ctx.companyId,
    jobId,
    fillItemId
  );
  if (!outputEntity) {
    throw new Error(`Fill job ${jobId}: output trackedEntity missing`);
  }

  const bulkMaterial = await ctx.db
    .selectFrom("jobMaterial")
    .select(["id", "itemId", "quantity"])
    .where("jobId", "=", jobId)
    .where("companyId", "=", ctx.companyId)
    .where("methodType", "=", "Pull from Inventory")
    .executeTakeFirst();
  if (!bulkMaterial) {
    throw new Error(`Fill job ${jobId}: bulk pull material missing`);
  }

  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const bulkQty = kgPerUnit * units;
  const issueResult = await invokePosting(
    handles,
    "issue",
    {
      type: "trackedEntitiesToOperation",
      materialId: bulkMaterial.id,
      jobOperationId: operation.id,
      itemId: bulkMaterial.itemId,
      parentTrackedEntityId: outputEntity.id,
      children: [{ trackedEntityId: bulkLotId, quantity: bulkQty }]
    },
    issueMaterial
  );
  if (issueResult.error) {
    throw new Error(`fill tracked issue (${label}): ${issueResult.error.message}`);
  }

  await reportBatchOperationCompleteMes(
    ctx,
    operation.id,
    outputEntity.id,
    units
  );
  await completeJobSpike(ctx, jobId, units);

  const outputLot = await resolveJobOutputTrackedEntity(
    ctx.db,
    ctx.companyId,
    jobId,
    fillItemId
  );
  const fillLots = outputLot ? [outputLot] : [];
  return { jobId, fillLots };
}

async function shipFillUnits(
  ctx: SpikeContext,
  fillItemId: string,
  quantity: number,
  fillLot: { id: string; quantity: number },
  key: string
) {
  const salesOrderId = `${ctx.prefix}-so-${key}`;
  await seedTrx(ctx.db, async (trx) => {
      await trx
        .insertInto("salesOrder")
        .values({
          id: salesOrderId,
          salesOrderId: `${ctx.prefix}-SO-${key}`,
          customerId: ctx.customerId,
          currencyCode: ctx.lookups.currencyCode,
          exchangeRate: 1,
          locationId: ctx.locationId,
          companyId: ctx.companyId,
          createdBy: ctx.userId
        })
        .execute();
      await trx
        .insertInto("salesOrderShipment")
        .values({ id: salesOrderId, companyId: ctx.companyId })
        .execute();
      await trx
        .insertInto("salesOrderLine")
        .values({
          salesOrderId,
          salesOrderLineType: "Part",
          itemId: fillItemId,
          saleQuantity: quantity,
          unitPrice: 5,
          methodType: "Pull from Inventory",
          unitOfMeasureCode: ctx.lookups.unitEa,
          locationId: ctx.locationId,
          companyId: ctx.companyId,
          createdBy: ctx.userId
        })
        .execute();
  });
  const shipment = unwrap(
    await invokeCreate(handlesOf({ db: ctx.db, companyId: ctx.companyId, userId: ctx.userId }), {
      type: "shipmentFromSalesOrder",
      salesOrderId,
      locationId: ctx.locationId
    })
  );

  const shipmentLine = await ctx.db
    .selectFrom("shipmentLine")
    .select(["id", "shippedQuantity", "requiresBatchTracking"])
    .where("companyId", "=", ctx.companyId)
    .where("shipmentId", "=", shipment.id)
    .where("itemId", "=", fillItemId)
    .executeTakeFirstOrThrow();

  const shipQty = Number(shipmentLine.shippedQuantity ?? quantity);
  if (shipmentLine.requiresBatchTracking) {
    if (fillLot.quantity < shipQty) {
      throw new Error(
        `Fill lot ${fillLot.id} holds ${fillLot.quantity}, cannot ship ${shipQty}`
      );
    }
    await assignFillLotToShipmentLine(ctx, {
      shipmentId: shipment.id,
      shipmentLineId: shipmentLine.id,
      trackedEntityId: fillLot.id,
      quantity: shipQty
    });
  }

  unwrap(
    await invokePosting(
      handlesOf({ db: ctx.db, companyId: ctx.companyId, userId: ctx.userId }),
      "post-shipment",
      { type: "post", shipmentId: shipment.id },
      postShipment
    )
  );
  return { salesOrderId, shipmentId: shipment.id };
}

export type RunSpikeFlowOptions = {
  /** When true, do not run tagged teardown — rows stay in ERP (product seed / UI walkthrough). */
  skipTeardown?: boolean;
};

export async function runSpikeFlow(
  ctx: SpikeContext,
  input: SpikeInput,
  note: (section: string, message: string) => void,
  options: RunSpikeFlowOptions = {}
): Promise<SpikeReportLine[]> {
  const extra: SpikeReportLine[] = [];
  const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
  note("tag", `Run tag ${ctx.prefix} (env prefix ${tag})`);
  note(
    "lookups",
    `UoM mass=${ctx.lookups.unitKg} count=${ctx.lookups.unitEa} currency=${ctx.lookups.currencyCode}`
  );

  if (options.skipTeardown) {
    note("reset", "Teardown skipped — seeded product left in ERP");
  } else {
    await teardownTagged(ctx.db, ctx.companyId, ctx.prefix);
    note("reset", `Cleared prior tagged rows for ${ctx.prefix}`);
  }

  const percentCheck = validatePercentSum(
    input.ingredients.map((i, idx) => ({
      id: String(idx),
      percentWw: i.percentage
    }))
  );
  if (!percentCheck.ok) {
    throw new Error(percentCheck.message);
  }
  note("formula", `Ingredient % total OK (${percentCheck.total})`);

  const catalogIngredients: SpikeIngredient[] = [...input.ingredients];
  if (input.secondProduct) {
    for (const ing of input.secondProduct.ingredients) {
      const code = resolveIngredientPartCode(ing);
      if (
        !catalogIngredients.some(
          (existing) => resolveIngredientPartCode(existing) === code
        )
      ) {
        catalogIngredients.push(ing);
      }
    }
  }
  const partCodeToItemId = await ensureSharedRawMaterialItems(
    ctx,
    catalogIngredients,
    note
  );
  const ingredientIds = ingredientItemIdsInOrder(
    input.ingredients,
    partCodeToItemId
  );
  const lotsByItem = new Map<string, { id: string; quantity: number }[]>();
  await receiveRawLotsForFormula(
    ctx,
    input,
    input.ingredients,
    ingredientIds,
    lotsByItem,
    note,
    "RAW"
  );

  const bulkSku = bulkItemReadableId(input.formulaRef);
  const bulkItemId = await ensureSpikePart(ctx, bulkSku, {
    name: input.product,
    replenishmentSystem: "Make",
    itemTrackingType: "Batch",
    unitOfMeasureCode: ctx.lookups.unitKg
  });
  await ensureItemBatchSequence(ctx, bulkItemId, bulkSku);
  const { makeMethodId } = await setupBulkItem(
    ctx.db,
    ctx,
    input,
    ingredientIds,
    bulkItemId
  );
  note("bulk", `Bulk item ${bulkItemId} with % formula and Skuu header`);

  let bulkRun: Awaited<ReturnType<typeof createAndRunBulkJob>>;
  try {
    bulkRun = await createAndRunBulkJob(
      ctx,
      input,
      bulkItemId,
      makeMethodId,
      lotsByItem
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    note("friction", `Bulk job path: ${msg}`);
    throw e;
  }
  for (const line of bulkRun.materialChecks) {
    note("scale", line);
  }
  note(
    "bulk",
    `Bulk job ${bulkRun.jobId} completed; gross input ${bulkRun.grossKg.toFixed(4)} kg for ${input.batchKg} kg target @ ${input.expectedYieldPercent}% yield`
  );
  if (!bulkRun.bulkLot) {
    note("friction", "No bulk lot found after completion — check batch output rules");
  } else {
    note(
      "bulk-lot",
      `Bulk lot ${bulkRun.bulkLot.id} (${bulkRun.bulkLot.readableId ?? "no label"}) qty ${bulkRun.bulkLot.quantity} status after MES batch complete: ${bulkRun.outputStatus}`
    );
  }

  const bulkLotId = bulkRun.bulkLot?.id;
  if (!bulkLotId) throw new Error("No bulk lot to fill from");

  let secondBulkLotId: string | undefined;
  if (input.secondProduct) {
    const second = input.secondProduct;
    const secondPct = validatePercentSum(
      second.ingredients.map((i, idx) => ({
        id: String(idx),
        percentWw: i.percentage
      }))
    );
    if (!secondPct.ok) {
      throw new Error(`secondProduct: ${secondPct.message}`);
    }
    const secondIngredientIds = ingredientItemIdsInOrder(
      second.ingredients,
      partCodeToItemId
    );
    await receiveRawLotsForFormula(
      ctx,
      second,
      second.ingredients,
      secondIngredientIds,
      lotsByItem,
      note,
      "RAW2"
    );
    const secondBulkSku = bulkItemReadableId(second.formulaRef);
    const secondBulkItemId = await ensureSpikePart(ctx, secondBulkSku, {
      name: second.product,
      replenishmentSystem: "Make",
      itemTrackingType: "Batch",
      unitOfMeasureCode: ctx.lookups.unitKg
    });
    await ensureItemBatchSequence(ctx, secondBulkItemId, secondBulkSku);
    const secondInput: SpikeInput = {
      ...input,
      product: second.product,
      formulaRef: second.formulaRef,
      batchKg: second.batchKg,
      expectedYieldPercent: second.expectedYieldPercent,
      ingredients: second.ingredients,
      fills: []
    };
    const { makeMethodId: secondMethodId } = await setupBulkItem(
      ctx.db,
      ctx,
      secondInput,
      secondIngredientIds,
      secondBulkItemId
    );
    await refreshLotQuantities(ctx, lotsByItem);
    const secondRun = await createAndRunBulkJob(
      ctx,
      secondInput,
      secondBulkItemId,
      secondMethodId,
      lotsByItem,
      "BULK-2"
    );
    secondBulkLotId = secondRun.bulkLot?.id;
    note(
      "bulk-2",
      `Second bulk job ${secondRun.jobId} → lot ${secondBulkLotId ?? "missing"}`
    );
    if (!secondBulkLotId) {
      throw new Error("Second product bulk lot missing after job complete");
    }
    const sharedRawLotId = [...lotsByItem.values()][0]?.[0]?.id;
    if (!sharedRawLotId) {
      throw new Error("No shared raw lot for cross-product assertion");
    }
    await assertSharedRawLotCrossBulkJobs(
      ctx.db,
      ctx.companyId,
      sharedRawLotId,
      [bulkLotId, secondBulkLotId]
    );
    note(
      "cross-product",
      `Shared raw lot consumed into both bulk lots (${bulkLotId}, ${secondBulkLotId}); forward trace OK`
    );
  }

  const fillResults: Awaited<ReturnType<typeof runFillJob>>[] = [];
  for (let f = 0; f < input.fills.length; f++) {
    const fill = input.fills[f]!;
    const fillSku = fillItemReadableId(input.formulaRef, fill.packSizeMl);
    const fillItemId = await ensureSpikePart(ctx, fillSku, {
      name: `Fill ${fill.packSizeMl}mL`,
      replenishmentSystem: "Make",
      itemTrackingType: "Batch",
      unitOfMeasureCode: ctx.lookups.unitEa
    });
    await ensureItemBatchSequence(ctx, fillItemId, fillSku);
    const { kgPerUnit } = await setupFillItem(
      ctx.db,
      ctx,
      String(f),
      fill.packSizeMl,
      bulkItemId,
      input.productDensityGPerMl,
      fillItemId
    );
    try {
      const fr = await runFillJob(
        ctx,
        fillItemId,
        fill.units,
        bulkLotId,
        kgPerUnit,
        `F${f}`
      );
      fillResults.push(fr);
      note(
        "fill",
        `Fill job ${fr.jobId}: ${fill.units}×${fill.packSizeMl}mL → ${fr.fillLots.length} lot(s)`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      note("friction", msg);
      throw e;
    }
  }

  const remainingBulk = await ctx.db
    .selectFrom("trackedEntity")
    .select(["quantity", "readableId"])
    .where("id", "=", bulkLotId)
    .executeTakeFirst();
  const bulkLotLabel =
    remainingBulk?.readableId ?? bulkRun.bulkLot?.readableId ?? bulkLotId;
  note(
    "bulk-remaining",
    remainingBulk
      ? `Bulk lot ${bulkLotLabel} (${bulkLotId}) remaining ${remainingBulk.quantity} kg after ${input.fills.length} fill jobs`
      : `Bulk lot ${bulkLotId} not found`
  );

  const allRawLotIds = [...lotsByItem.values()].flatMap((lots) =>
    lots.map((l) => l.id)
  );
  const fillLotIds = fillResults.flatMap((fr) =>
    fr.fillLots.map((lot) => lot.id)
  );

  const shippedLot = fillResults[0]?.fillLots[0];
  let shipmentId: string | undefined;
  if (shippedLot) {
    const fillItemId = await ctx.db
      .selectFrom("item")
      .select("id")
      .where("companyId", "=", ctx.companyId)
      .where("readableId", "=", fillItemReadableId(input.formulaRef, input.fills[0]!.packSizeMl))
      .executeTakeFirstOrThrow()
      .then((r) => r.id);
    const lotForShip = await ctx.db
      .selectFrom("trackedEntity")
      .select(["id", "quantity", "readableId"])
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", shippedLot.id)
      .executeTakeFirstOrThrow();
    const ship = await shipFillUnits(
      ctx,
      fillItemId,
      10,
      { id: lotForShip.id, quantity: Number(lotForShip.quantity) },
      "0"
    );
    shipmentId = ship.shipmentId;
    note(
      "ship",
      `Posted shipment for 10 units of ${lotForShip.readableId ?? fillItemId} (lot ${lotForShip.id})`
    );
  }

  const rawLot = [...lotsByItem.values()][0]?.[0]?.id;
  if (rawLot && bulkLotId && shippedLot && shipmentId) {
    const rawMeta = await ctx.db
      .selectFrom("trackedEntity")
      .select("readableId")
      .where("id", "=", rawLot)
      .executeTakeFirst();
    const rawStartLabel = rawMeta?.readableId ?? rawLot;

    const forwardNodes = await traceActivityLineage(
      ctx.db,
      ctx.companyId,
      rawLot,
      "forward"
    );
    const forwardFmt = formatTraceReport(forwardNodes, {
      direction: "forward",
      startLabel: rawStartLabel,
      shipmentHop: { shipmentId }
    });
    note("trace-forward", forwardFmt.summary);
    for (const layer of forwardFmt.layers) {
      note("trace-forward", layer);
    }

    const reverseNodes = await traceActivityLineage(
      ctx.db,
      ctx.companyId,
      shippedLot.id,
      "back"
    );
    const shippedLabel =
      shippedLot.readableId ??
      (
        await ctx.db
          .selectFrom("trackedEntity")
          .select("readableId")
          .where("id", "=", shippedLot.id)
          .executeTakeFirst()
      )?.readableId ??
      shippedLot.id;
    const reverseFmt = formatTraceReport(reverseNodes, {
      direction: "back",
      startLabel: shippedLabel
    });
    note("trace-reverse", reverseFmt.summary);
    for (const layer of reverseFmt.layers) {
      note("trace-reverse", layer);
    }

    assertSpikeTrace({
      forwardFromRawId: rawLot,
      forwardNodes,
      reverseFromShippedId: shippedLot.id,
      reverseNodes,
      bulkLotId,
      allRawLotIds,
      fillLotIds,
      shipmentId
    });
    note("trace", "Forward/reverse genealogy assertions passed");
  }

  note("done", "Spike flow finished");
  return extra;
}