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
import { ensureSpikePart } from "./item-factory";
import {
  assertJobConsumptionTrace,
  assertJobMaterialsGross,
  issueTrackedMaterialsMes,
  reportBatchOperationCompleteMes,
  resolveJobOutputTrackedEntity,
  syncSkuuBulkToPostgrest
} from "./spike-mes";
import { teardownTagged } from "./teardown";

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
  const processId = `${ctx.prefix}-proc`;
  const operationId = `${ctx.prefix}-mop`;
  const formulaRows: { methodMaterialId: string; percentWw: number }[] = [];

  const makeMethodId = await runTrx(db, async (trx) => {
    const resolvedMakeMethodId = await resolveSpikeMakeMethodId(
      trx,
      ctx.companyId,
      ctx.userId,
      bulkItemId
    );
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: `${input.product} mix`,
        defaultStandardFactor: ctx.lookups.standardFactor,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("methodOperation")
      .values({
        id: operationId,
        makeMethodId: resolvedMakeMethodId,
        processId,
        description: "Blend",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    for (let i = 0; i < input.ingredients.length; i++) {
      const ing = input.ingredients[i]!;
      const methodMaterialId = `${ctx.prefix}-mmat-${i}`;
      await trx
        .insertInto("methodMaterial")
        .values({
          id: methodMaterialId,
          makeMethodId: resolvedMakeMethodId,
          methodOperationId: operationId,
          itemId: ingredientItemIds[i]!,
          itemType: "Part",
          methodType: "Pull from Inventory",
          quantity: 0,
          unitOfMeasureCode: ctx.lookups.unitKg,
          companyId: ctx.companyId,
          createdBy: ctx.userId
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
      await trx
        .insertInto("skuuMethodMaterialFormula")
        .values({
          methodMaterialId,
          companyId: ctx.companyId,
          percentWw: ing.percentage,
          phaseNumber: 1,
          createdBy: ctx.userId,
          updatedBy: ctx.userId
        })
        .onConflict((oc) => oc.column("methodMaterialId").doNothing())
        .execute();
      formulaRows.push({ methodMaterialId, percentWw: ing.percentage });
    }

    await trx
      .insertInto("skuuFormulaPhase")
      .values({
        makeMethodId: resolvedMakeMethodId,
        phaseNumber: 1,
        companyId: ctx.companyId,
        instructions: "Spike demo phase — precautions N/A.",
        createdBy: ctx.userId,
        updatedBy: ctx.userId
      })
      .onConflict((oc) =>
        oc.columns(["makeMethodId", "phaseNumber"]).doNothing()
      )
      .execute();
    return resolvedMakeMethodId;
  });

  await syncSkuuBulkToPostgrest(ctx, makeMethodId, input, formulaRows);

  return { bulkItemId, processId, makeMethodId };
}

async function createAndRunBulkJob(
  ctx: SpikeContext,
  input: SpikeInput,
  bulkItemId: string,
  makeMethodId: string,
  lotsByItem: Map<string, { id: string; quantity: number }[]>
) {
  const client = ctx.service.asSystem.supabase;
  const created = await insertJob(client, ctx.db, {
    itemId: bulkItemId,
    quantity: input.batchKg,
    unitOfMeasureCode: ctx.lookups.unitKg,
    locationId: ctx.locationId,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    jobId: `${ctx.prefix}-JOB-BULK`
  } as never);
  if (created.error || !created.data) {
    throw new Error(`insertJob failed: ${created.error?.message ?? "unknown"}`);
  }
  const jobId = created.data.id;
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
          .select("id")
          .where("jobId", "=", jobId)
          .where("itemId", "=", multiLotItemId)
          .executeTakeFirst()
      : null;
  if (jobMat0 && multiLotItemId) {
    const lots = lotsByItem.get(multiLotItemId) ?? [];
    if (lots.length >= 2) {
      await ctx.db
        .insertInto("skuuJobMaterialDispense")
        .values([
          {
            id: nanoid(),
            jobMaterialId: jobMat0.id,
            companyId: ctx.companyId,
            trackedEntityId: lots[0]!.id,
            quantityKg: lots[0]!.quantity > 0 ? Math.min(3, lots[0]!.quantity) : 1,
            supplierBatchNumber: `${lots[0]!.id}-A`,
            sortOrder: 0,
            createdBy: ctx.userId
          },
          {
            id: nanoid(),
            jobMaterialId: jobMat0.id,
            companyId: ctx.companyId,
            trackedEntityId: lots[1]!.id,
            quantityKg: 2,
            supplierBatchNumber: `${lots[1]!.id}-B`,
            sortOrder: 1,
            createdBy: ctx.userId
          }
        ])
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
    const processId = `${ctx.prefix}-fproc-${key}`;
    const opId = `${ctx.prefix}-fop-${key}`;
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: `Fill ${packSizeMl}mL`,
        defaultStandardFactor: ctx.lookups.standardFactor,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("methodOperation")
      .values({
        id: opId,
        makeMethodId,
        processId,
        description: "Fill",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("methodMaterial")
      .values({
        id: `${ctx.prefix}-fmat-${key}`,
        makeMethodId,
        methodOperationId: opId,
        itemId: bulkItemId,
        itemType: "Part",
        methodType: "Pull from Inventory",
        quantity: kgPerUnit,
        unitOfMeasureCode: ctx.lookups.unitKg,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
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

async function traceLineage(
  db: Db,
  companyId: string,
  entityId: string,
  direction: "forward" | "back"
) {
  if (direction === "forward") {
    const { rows } = await sql<{ id: string; readableId: string | null }>`
      SELECT DISTINCT te.id, te."readableId"
      FROM "trackedActivityInput" tai
      JOIN "trackedActivityOutput" tao
        ON tao."trackedActivityId" = tai."trackedActivityId"
        AND tao."companyId" = ${companyId}
      JOIN "trackedEntity" te
        ON te.id = tao."trackedEntityId"
        AND te."companyId" = ${companyId}
      WHERE tai."trackedEntityId" = ${entityId}
        AND tai."companyId" = ${companyId}
    `.execute(db);
    return rows;
  }
  const { rows } = await sql<{ id: string; readableId: string | null }>`
    WITH RECURSIVE ancestors AS (
      SELECT ai."trackedEntityId" AS child_id, ao."trackedEntityId" AS parent_id
      FROM "trackedActivityOutput" ao
      JOIN "trackedActivityInput" ai ON ai."trackedActivityId" = ao."trackedActivityId"
      WHERE ao."trackedEntityId" = ${entityId}
      UNION
      SELECT ai."trackedEntityId", ao."trackedEntityId"
      FROM ancestors a
      JOIN "trackedActivityOutput" ao ON ao."trackedEntityId" = a.parent_id
      JOIN "trackedActivityInput" ai ON ai."trackedActivityId" = ao."trackedActivityId"
    )
    SELECT DISTINCT te.id, te."readableId"
    FROM ancestors
    JOIN "trackedEntity" te ON te.id = ancestors.parent_id
    WHERE te."companyId" = ${companyId}
  `.execute(db);
  return rows;
}

export async function runSpikeFlow(
  ctx: SpikeContext,
  input: SpikeInput,
  note: (section: string, message: string) => void
): Promise<SpikeReportLine[]> {
  const extra: SpikeReportLine[] = [];
  const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
  note("tag", `Run tag ${ctx.prefix} (env prefix ${tag})`);
  note(
    "lookups",
    `UoM mass=${ctx.lookups.unitKg} count=${ctx.lookups.unitEa} currency=${ctx.lookups.currencyCode}`
  );

  await teardownTagged(ctx.db, ctx.companyId, ctx.prefix);
  note("reset", `Cleared prior tagged rows for ${ctx.prefix}`);

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

  const ingredientIds: string[] = [];
  const lotsByItem = new Map<string, { id: string; quantity: number }[]>();
  for (let i = 0; i < input.ingredients.length; i++) {
    const ing = input.ingredients[i]!;
    const itemId = await ensureSpikePart(
      ctx,
      spikeReadableId(ctx, `RM-${i}`),
      {
        name: ing.name,
        replenishmentSystem: "Buy",
        itemTrackingType: "Batch",
        unitOfMeasureCode: ctx.lookups.unitKg,
        unitCost: 1
      }
    );
    ingredientIds.push(itemId);
    const grossKg = manufactureFromExpectedYield(
      input.batchKg,
      input.expectedYieldPercent
    );
    const need = lineKgFromPercent(ing.percentage, grossKg) * 1.05;
    const lotA = await receiveLot(
      ctx,
      itemId,
      need,
      `${ctx.prefix}-LOT-${i}-A`
    );
    const lots = [{ id: lotA.id, quantity: Number(lotA.quantity) }];
    if (i === 0) {
      const lotB = await receiveLot(
        ctx,
        itemId,
        need * 0.4,
        `${ctx.prefix}-LOT-${i}-B`
      );
      lots.push({ id: lotB.id, quantity: Number(lotB.quantity) });
      note(
        "receive",
        `Ingredient ${ing.name}: 2 lots (${lotA.readableId}, ${lotB.readableId}) for dispense scaffold`
      );
    } else {
      note("receive", `Ingredient ${ing.name}: lot ${lotA.readableId}`);
    }
    lotsByItem.set(itemId, lots);
  }

  const bulkItemId = await ensureSpikePart(ctx, spikeReadableId(ctx, "BULK"), {
    name: input.product,
    replenishmentSystem: "Make",
    itemTrackingType: "Batch",
    unitOfMeasureCode: ctx.lookups.unitKg
  });
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

  const fillResults: Awaited<ReturnType<typeof runFillJob>>[] = [];
  for (let f = 0; f < input.fills.length; f++) {
    const fill = input.fills[f]!;
    const fillItemId = await ensureSpikePart(
      ctx,
      spikeReadableId(ctx, `FILL-${f}`),
      {
        name: `Fill ${fill.packSizeMl}mL`,
        replenishmentSystem: "Make",
        itemTrackingType: "Batch",
        unitOfMeasureCode: ctx.lookups.unitEa
      }
    );
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
  note(
    "bulk-remaining",
    remainingBulk
      ? `Bulk lot ${remainingBulk.readableId} remaining ${remainingBulk.quantity} kg after ${input.fills.length} fill jobs`
      : "Bulk lot not found"
  );

  const shippedLot = fillResults[0]?.fillLots[0];
  if (shippedLot) {
    const fillItemId = await ctx.db
      .selectFrom("item")
      .select("id")
      .where("companyId", "=", ctx.companyId)
      .where("readableId", "=", spikeReadableId(ctx, "FILL-0"))
      .executeTakeFirstOrThrow()
      .then((r) => r.id);
    await shipFillUnits(ctx, fillItemId, 10, "0");
    note("ship", "Posted shipment for 10 units of first fill SKU");
  }

  const rawLot = [...lotsByItem.values()][0]?.[0]?.id;
  if (rawLot && bulkLotId) {
    const forward = await traceLineage(
      ctx.db,
      ctx.companyId,
      rawLot,
      "forward"
    );
    note(
      "trace-forward",
      `From raw lot ${rawLot}: ${forward.map((r) => r.readableId ?? r.id).join(" → ") || "(none)"}`
    );
    if (shippedLot) {
      const back = await traceLineage(
        ctx.db,
        ctx.companyId,
        shippedLot.id,
        "back"
      );
      note(
        "trace-reverse",
        `From fill lot ${shippedLot.readableId}: ${back.map((r) => r.readableId ?? r.id).join(" ← ") || "(none)"}`
      );
    }
  }

  note("done", "Spike flow finished");
  return extra;
}