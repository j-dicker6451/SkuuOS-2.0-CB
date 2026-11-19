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
} from "../../apps/erp/app/modules/inventory/inventory.service";
import { invokeCreate, invokePosting } from "../../apps/erp/app/modules/shared/shared.service";
import { releaseJobs, completeJob } from "../../apps/erp/app/modules/production/production.server";
import { insertJob, recalculateJobRequirements } from "../../apps/erp/app/modules/production/production.service";
import { handlesOf } from "../../apps/erp/test/database/fixtures/handles";
import { seedTrx, unwrap, SPIKE_USER } from "./posting-helpers";
import type { SpikeContext, SpikeInput } from "./context";
import type { SpikeReportLine } from "./report";

type Db = SpikeContext["db"];

async function runTrx<T>(
  db: Db,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    return fn(trx);
  });
}

async function teardownTagged(db: Db, companyId: string, prefix: string) {
  await runTrx(db, async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
  await trx
    .deleteFrom("skuuJobMaterialDispense")
    .where("companyId", "=", companyId)
    .where("id", "like", `${prefix}%`)
    .execute();
  await trx
    .deleteFrom("job")
    .where("companyId", "=", companyId)
    .where("id", "like", `${prefix}%`)
    .execute();
  await trx
    .deleteFrom("trackedEntity")
    .where("companyId", "=", companyId)
    .where("id", "like", `${prefix}%`)
    .execute();
  await trx
    .deleteFrom("item")
    .where("companyId", "=", companyId)
    .where("id", "like", `${prefix}%`)
    .execute();
    await sql`SET LOCAL session_replication_role = origin`.execute(trx);
  });
}

async function ensureBatchItem(
  db: Db,
  ctx: SpikeContext,
  key: string,
  name: string
) {
  const itemId = `${ctx.prefix}-rm-${key}`;
  await runTrx(db, async (trx) => {
    const exists = await trx
      .selectFrom("item")
      .select("id")
      .where("id", "=", itemId)
      .executeTakeFirst();
    if (exists) return;
    await trx
      .insertInto("item")
      .values({
        id: itemId,
        readableId: `${ctx.prefix}-RM-${key}`,
        name,
        type: "Part",
        itemTrackingType: "Batch",
        replenishmentSystem: "Buy",
        unitOfMeasureCode: "KG",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .execute();
    await trx
      .insertInto("itemCost")
      .values({
        itemId,
        costingMethod: "FIFO",
        unitCost: 1,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  });
  return itemId;
}

async function receiveLot(
  ctx: SpikeContext,
  itemId: string,
  quantity: number,
  lotLabel: string
) {
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
      readableId: lotLabel
    },
    postInventoryAdjustment
  );
  unwrap(result);
  const lot = await ctx.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity"])
    .where("companyId", "=", ctx.companyId)
    .where("itemId", "=", itemId)
    .where("readableId", "=", lotLabel)
    .executeTakeFirstOrThrow();
  return lot;
}

async function setupBulkItem(
  db: Db,
  ctx: SpikeContext,
  input: SpikeInput,
  ingredientItemIds: string[]
) {
  const bulkItemId = `${ctx.prefix}-bulk`;
  const makeMethodId = `${ctx.prefix}-mm`;
  const processId = `${ctx.prefix}-proc`;
  const operationId = `${ctx.prefix}-mop`;

  await runTrx(db, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: bulkItemId,
        readableId: `${ctx.prefix}-BULK`,
        name: input.product,
        type: "Part",
        itemTrackingType: "Batch",
        replenishmentSystem: "Make",
        unitOfMeasureCode: "KG",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("makeMethod")
      .values({
        id: makeMethodId,
        itemId: bulkItemId,
        version: 1,
        status: "Active",
        isDefault: true,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: `${input.product} mix`,
        defaultStandardFactor: "Hours/Piece",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("methodOperation")
      .values({
        id: operationId,
        makeMethodId,
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
          makeMethodId,
          methodOperationId: operationId,
          itemId: ingredientItemIds[i]!,
          itemType: "Part",
          methodType: "Pull from Inventory",
          description: ing.name,
          quantity: ing.percentage / 100,
          unitOfMeasureCode: "KG",
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
    }

    await trx
      .insertInto("skuuMakeMethodBulk")
      .values({
        makeMethodId,
        companyId: ctx.companyId,
        enabled: true,
        batchBasisKg: 1,
        expectedYieldPercent: input.expectedYieldPercent,
        productDensityGPerMl: input.productDensityGPerMl,
        yieldLossPercent: 0,
        createdBy: ctx.userId,
        updatedBy: ctx.userId
      })
      .onConflict((oc) => oc.column("makeMethodId").doNothing())
      .execute();
    await trx
      .insertInto("skuuFormulaPhase")
      .values({
        makeMethodId,
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
  });

  return { bulkItemId, makeMethodId, processId };
}

async function createAndRunBulkJob(
  ctx: SpikeContext,
  input: SpikeInput,
  bulkItemId: string,
  lotsByItem: Map<string, { id: string; quantity: number }[]>
) {
  const grossKg = manufactureFromExpectedYield(
    input.batchKg,
    input.expectedYieldPercent
  );
  const client = ctx.service.asSystem.supabase;
  const created = await insertJob(client, ctx.db, {
    itemId: bulkItemId,
    quantity: input.batchKg,
    unitOfMeasureCode: "KG",
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
      .innerJoin(
        "skuuMethodMaterialFormula as f",
        "f.methodMaterialId",
        "jm.sourceMethodMaterialId"
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

  const released = await releaseJobs(ctx.service, { jobIds: [jobId] });
  if (released.error) {
    throw new Error(`releaseJobs: ${released.error.message}`);
  }
  if (released.data?.failed?.length) {
    throw new Error(
      `releaseJobs failed: ${released.data.failed.map((f) => f.message).join("; ")}`
    );
  }

  const operation = await ctx.db
    .selectFrom("jobOperation")
    .select("id")
    .where("jobId", "=", jobId)
    .orderBy("id")
    .limit(1)
    .executeTakeFirstOrThrow();

  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const issueResult = await invokePosting(
    handles,
    "issue",
    { type: "jobOperation", id: operation.id, quantity: input.batchKg },
    issueMaterial
  );
  if (issueResult.error) {
    throw new Error(`issue bulk job: ${issueResult.error.message}`);
  }

  for (const [itemId, lots] of lotsByItem) {
    const jm = materials.find(() => true);
    void jm;
    const jobMat = await ctx.db
      .selectFrom("jobMaterial")
      .select("id")
      .where("jobId", "=", jobId)
      .where("itemId", "=", itemId)
      .executeTakeFirst();
    if (!jobMat || lots.length < 2) continue;
    await ctx.db
      .insertInto("skuuJobMaterialDispense")
      .values([
        {
          id: nanoid(),
          jobMaterialId: jobMat.id,
          companyId: ctx.companyId,
          trackedEntityId: lots[0]!.id,
          quantityKg: lots[0]!.quantity > 0 ? Math.min(3, lots[0]!.quantity) : 1,
          supplierBatchNumber: `${lots[0]!.id}-A`,
          sortOrder: 0,
          createdBy: ctx.userId
        },
        {
          id: nanoid(),
          jobMaterialId: jobMat.id,
          companyId: ctx.companyId,
          trackedEntityId: lots[1]!.id,
          quantityKg: 2,
          supplierBatchNumber: `${lots[1]!.id}-B`,
          sortOrder: 1,
          createdBy: ctx.userId
        }
      ])
      .execute();
  }

  const completion = await completeJob(ctx.service, {
    jobId,
    quantityComplete: input.batchKg,
    locationId: ctx.locationId
  });
  if (completion.error) {
    throw new Error(`completeJob: ${completion.error.message}`);
  }

  const bulkLot = await ctx.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity"])
    .where("companyId", "=", ctx.companyId)
    .where("itemId", "=", bulkItemId)
    .where("status", "=", "Available")
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();

  return {
    jobId,
    jobRow,
    materialChecks,
    bulkLot,
    grossKg,
    operationId: operation.id
  };
}

async function setupFillItem(
  db: Db,
  ctx: SpikeContext,
  key: string,
  packSizeMl: number,
  bulkItemId: string,
  density: number
) {
  const fillItemId = `${ctx.prefix}-fill-${key}`;
  const makeMethodId = `${ctx.prefix}-fmm-${key}`;
  const kgPerUnit = (packSizeMl * density) / 1000;
  await runTrx(db, async (trx) => {
    await trx
      .insertInto("item")
      .values({
        id: fillItemId,
        readableId: `${ctx.prefix}-FILL-${key}`,
        name: `Fill ${packSizeMl}mL`,
        type: "Part",
        itemTrackingType: "Batch",
        replenishmentSystem: "Make",
        unitOfMeasureCode: "EA",
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    await trx
      .insertInto("makeMethod")
      .values({
        id: makeMethodId,
        itemId: fillItemId,
        version: 1,
        status: "Active",
        isDefault: true,
        companyId: ctx.companyId,
        createdBy: ctx.userId
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    const processId = `${ctx.prefix}-fproc-${key}`;
    const opId = `${ctx.prefix}-fop-${key}`;
    await trx
      .insertInto("process")
      .values({
        id: processId,
        name: `Fill ${packSizeMl}mL`,
        defaultStandardFactor: "Hours/Piece",
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
        description: "Bulk",
        quantity: kgPerUnit,
        unitOfMeasureCode: "KG",
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
  label: string
) {
  const client = ctx.service.asSystem.supabase;
  const created = await insertJob(client, ctx.db, {
    itemId: fillItemId,
    quantity: units,
    unitOfMeasureCode: "EA",
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
  const released = await releaseJobs(ctx.service, { jobIds: [jobId] });
  if (released.error) throw new Error(released.error.message);
  if (released.data?.failed?.length) {
    throw new Error(released.data.failed[0]!.message);
  }

  const operation = await ctx.db
    .selectFrom("jobOperation")
    .select("id")
    .where("jobId", "=", jobId)
    .limit(1)
    .executeTakeFirstOrThrow();

  const handles = handlesOf({
    db: ctx.db,
    companyId: ctx.companyId,
    userId: ctx.userId
  });
  const issueResult = await invokePosting(
    handles,
    "issue",
    { type: "jobOperation", id: operation.id, quantity: units },
    issueMaterial
  );
  if (issueResult.error) {
    throw new Error(
      `fill issue (${label}): ${issueResult.error.message} (friction: same bulk lot on two fill jobs may need explicit trackedEntityIds per line)`
    );
  }
  const completion = await completeJob(ctx.service, {
    jobId,
    quantityComplete: units,
    locationId: ctx.locationId
  });
  if (completion.error) {
    throw new Error(`fill complete: ${completion.error.message}`);
  }
  const fillLots = await ctx.db
    .selectFrom("trackedEntity")
    .select(["id", "readableId", "quantity"])
    .where("companyId", "=", ctx.companyId)
    .where("itemId", "=", fillItemId)
    .where("status", "=", "Available")
    .execute();
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
          currencyCode: "USD",
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
          methodType: "Pick from Inventory",
          unitOfMeasureCode: "EA",
          locationId: ctx.locationId,
          companyId: ctx.companyId,
          createdBy: SPIKE_USER
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
    const itemId = await ensureBatchItem(
      ctx.db,
      ctx,
      String(i),
      ing.name
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

  const { bulkItemId } = await setupBulkItem(
    ctx.db,
    ctx,
    input,
    ingredientIds
  );
  note("bulk", `Bulk item ${bulkItemId} with % formula and Skuu header`);

  let bulkRun: Awaited<ReturnType<typeof createAndRunBulkJob>>;
  try {
    bulkRun = await createAndRunBulkJob(ctx, input, bulkItemId, lotsByItem);
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
      `Bulk lot ${bulkRun.bulkLot.readableId} qty ${bulkRun.bulkLot.quantity}`
    );
  }

  const bulkLotId = bulkRun.bulkLot?.id;
  if (!bulkLotId) throw new Error("No bulk lot to fill from");

  const fillResults: Awaited<ReturnType<typeof runFillJob>>[] = [];
  for (let f = 0; f < input.fills.length; f++) {
    const fill = input.fills[f]!;
    const { fillItemId } = await setupFillItem(
      ctx.db,
      ctx,
      String(f),
      fill.packSizeMl,
      bulkItemId,
      input.productDensityGPerMl
    );
    try {
      const fr = await runFillJob(
        ctx,
        fillItemId,
        fill.units,
        bulkLotId,
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
    const fillItemId = `${ctx.prefix}-fill-0`;
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