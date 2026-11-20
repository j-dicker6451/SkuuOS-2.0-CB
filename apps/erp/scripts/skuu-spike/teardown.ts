// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import type { SpikeDb, SpikeTrx } from "./spike-db";

type Db = SpikeDb;
type Trx = SpikeTrx;

function savepointName(step: string) {
  return `teardown_${step.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 48)}`;
}

async function teardownStep<T>(
  trx: Trx,
  step: string,
  fn: () => Promise<T>
): Promise<T> {
  const sp = savepointName(step);
  await sql.raw(`SAVEPOINT ${sp}`).execute(trx);
  try {
    const result = await fn();
    await sql.raw(`RELEASE SAVEPOINT ${sp}`).execute(trx);
    return result;
  } catch (err) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`).execute(trx);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`teardown step ${step}: ${message}`);
  }
}

async function runTeardownTrx<T>(
  db: Db,
  fn: (trx: Trx) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await teardownStep(trx, "init-sync-in-progress", async () => {
      await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    });
    await teardownStep(trx, "init-replication-replica", async () => {
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    });
    return fn(trx);
  });
}

async function deleteCompanyRows(
  trx: Trx,
  table:
    | "trackedActivityInput"
    | "trackedActivityOutput"
    | "trackedActivity"
    | "productionQuantity"
    | "productionEvent"
    | "jobOperationTrackedEntity"
    | "jobMaterialScrap"
    | "jobMaterial"
    | "jobOperationStep"
    | "jobOperation"
    | "jobMakeMethod"
    | "job"
    | "itemLedger"
    | "journalLineDimension"
    | "journalLine"
    | "journal"
    | "shipmentLine"
    | "shipment"
    | "trackedEntity",
  companyId: string,
  column:
    | "trackedActivityId"
    | "jobOperationId"
    | "jobMaterialId"
    | "jobId"
    | "operationId"
    | "id"
    | "documentId"
    | "journalId"
    | "journalLineId"
    | "shipmentId"
    | "itemId",
  ids: string[]
) {
  if (ids.length === 0) return;
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    await trx
      .deleteFrom(table)
      .where("companyId", "=", companyId)
      .where(column, "in", slice)
      .execute();
  }
}

async function deleteJobMaterialSteps(
  trx: Trx,
  jobMaterialIds: string[],
  jobOperationStepIds: string[]
) {
  const chunk = 200;
  if (jobMaterialIds.length > 0) {
    for (let i = 0; i < jobMaterialIds.length; i += chunk) {
      const slice = jobMaterialIds.slice(i, i + chunk);
      await trx
        .deleteFrom("jobMaterialStep")
        .where("jobMaterialId", "in", slice)
        .execute();
    }
  }
  if (jobOperationStepIds.length > 0) {
    for (let i = 0; i < jobOperationStepIds.length; i += chunk) {
      const slice = jobOperationStepIds.slice(i, i + chunk);
      await trx
        .deleteFrom("jobMaterialStep")
        .where("jobOperationStepId", "in", slice)
        .execute();
    }
  }
}

async function deleteJobGraph(
  trx: Trx,
  companyId: string,
  jobIds: string[],
  jobOpIds: string[]
) {
  const jobMaterialIds = (
    await trx
      .selectFrom("jobMaterial")
      .select("id")
      .where("companyId", "=", companyId)
      .where("jobId", "in", jobIds)
      .execute()
  ).map((r) => r.id);

  const jobOperationStepIds =
    jobOpIds.length > 0
      ? (
          await trx
            .selectFrom("jobOperationStep")
            .select("id")
            .where("companyId", "=", companyId)
            .where("operationId", "in", jobOpIds)
            .execute()
        ).map((r) => r.id)
      : [];

  await deleteJobMaterialSteps(trx, jobMaterialIds, jobOperationStepIds);

  if (jobMaterialIds.length > 0) {
    await deleteCompanyRows(
      trx,
      "jobMaterialScrap",
      companyId,
      "jobMaterialId",
      jobMaterialIds
    );
    await deleteSpikeTableRows(
      trx,
      "skuuJobMaterialDispense",
      companyId,
      "jobMaterialId",
      jobMaterialIds
    );
  }

  await deleteCompanyRows(trx, "jobMaterial", companyId, "jobId", jobIds);

  if (jobOpIds.length > 0) {
    await deleteCompanyRows(
      trx,
      "jobOperationStep",
      companyId,
      "operationId",
      jobOpIds
    );
  }
  await deleteCompanyRows(trx, "jobOperation", companyId, "jobId", jobIds);

  await deleteCompanyRows(trx, "jobMakeMethod", companyId, "jobId", jobIds);
  await deleteCompanyRows(trx, "job", companyId, "id", jobIds);
}

type SpikeDbTable = "costLedger" | "skuuFormulaPhase" | "skuuJobMaterialDispense";

async function deleteSpikeTableRows(
  trx: Trx,
  table: SpikeDbTable,
  companyId: string,
  column: string,
  ids: string[]
) {
  if (ids.length === 0) return;
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    await sql`
      DELETE FROM ${sql.table(table)}
      WHERE "companyId" = ${companyId}
        AND ${sql.ref(column)} = ANY(${slice}::text[])
    `.execute(trx);
  }
}

async function deleteSpikeTableLike(
  trx: Trx,
  table: SpikeDbTable,
  companyId: string,
  column: string,
  likePrefix: string
) {
  await sql`
    DELETE FROM ${sql.table(table)}
    WHERE "companyId" = ${companyId}
      AND ${sql.ref(column)} LIKE ${likePrefix}
  `.execute(trx);
}

/** Journals link to jobs/shipments via journalLine.documentId, not journal.sourceDocumentId. */
async function deleteSpikeJournals(
  trx: Trx,
  companyId: string,
  documentIds: string[]
) {
  if (documentIds.length === 0) return;
  const lineRows = await trx
    .selectFrom("journalLine")
    .select(["id", "journalId"])
    .where("companyId", "=", companyId)
    .where("documentId", "in", documentIds)
    .execute();
  const lineIds = lineRows.map((r) => r.id);
  const journalIds = [...new Set(lineRows.map((r) => r.journalId))];
  if (journalIds.length === 0) return;
  await deleteCompanyRows(
    trx,
    "journalLineDimension",
    companyId,
    "journalLineId",
    lineIds
  );
  await deleteCompanyRows(trx, "journalLine", companyId, "journalId", journalIds);
  await deleteCompanyRows(trx, "journal", companyId, "id", journalIds);
}

async function deleteTrackedActivityGraph(
  trx: Trx,
  companyId: string,
  jobOpIds: string[],
  trackedEntityIds: string[]
) {
  const activityIdSet = new Set<string>();

  if (jobOpIds.length > 0) {
    const ops = await trx
      .selectFrom("trackedActivity")
      .select("id")
      .where("companyId", "=", companyId)
      .where("sourceDocument", "=", "Job Operation")
      .where("sourceDocumentId", "in", jobOpIds)
      .execute();
    for (const row of ops) activityIdSet.add(row.id);
  }

  if (trackedEntityIds.length > 0) {
    const viaInput = await trx
      .selectFrom("trackedActivityInput")
      .select("trackedActivityId")
      .where("companyId", "=", companyId)
      .where("trackedEntityId", "in", trackedEntityIds)
      .execute();
    const viaOutput = await trx
      .selectFrom("trackedActivityOutput")
      .select("trackedActivityId")
      .where("companyId", "=", companyId)
      .where("trackedEntityId", "in", trackedEntityIds)
      .execute();
    for (const row of [...viaInput, ...viaOutput]) {
      activityIdSet.add(row.trackedActivityId);
    }
  }

  const activityIds = [...activityIdSet];
  if (activityIds.length === 0) return;

  await deleteCompanyRows(
    trx,
    "trackedActivityInput",
    companyId,
    "trackedActivityId",
    activityIds
  );
  await deleteCompanyRows(
    trx,
    "trackedActivityOutput",
    companyId,
    "trackedActivityId",
    activityIds
  );
  await deleteCompanyRows(trx, "trackedActivity", companyId, "id", activityIds);
}

async function deleteSpikeLedgers(
  trx: Trx,
  companyId: string,
  itemIds: string[],
  jobIds: string[],
  shipmentIds: string[],
  trackedEntityIds: string[]
) {
  const ledgers = await trx
    .selectFrom("itemLedger")
    .select("id")
    .where("companyId", "=", companyId)
    .where((eb) => {
      const parts = [];
      if (itemIds.length > 0) {
        parts.push(eb("itemId", "in", itemIds));
      }
      if (jobIds.length > 0) {
        parts.push(eb("documentId", "in", jobIds));
      }
      if (shipmentIds.length > 0) {
        parts.push(eb("documentId", "in", shipmentIds));
      }
      if (trackedEntityIds.length > 0) {
        parts.push(eb("trackedEntityId", "in", trackedEntityIds));
      }
      return parts.length > 0 ? eb.or(parts) : eb.val(false);
    })
    .execute();
  const ledgerIds = ledgers.map((r) => r.id);
  if (ledgerIds.length === 0) return;

  const costIds = new Set<string>();
  if (itemIds.length > 0) {
    const rows = await sql<{ id: string }>`
      SELECT id FROM "costLedger"
      WHERE "companyId" = ${companyId}
        AND "itemId" = ANY(${itemIds}::text[])
    `.execute(trx);
    for (const row of rows.rows) costIds.add(row.id);
  }
  const docIds = [...jobIds, ...shipmentIds];
  if (docIds.length > 0) {
    const rows = await sql<{ id: string }>`
      SELECT id FROM "costLedger"
      WHERE "companyId" = ${companyId}
        AND "documentId" = ANY(${docIds}::text[])
    `.execute(trx);
    for (const row of rows.rows) costIds.add(row.id);
  }
  if (trackedEntityIds.length > 0) {
    const rows = await sql<{ id: string }>`
      SELECT id FROM "costLedger"
      WHERE "companyId" = ${companyId}
        AND "trackedEntityId" = ANY(${trackedEntityIds}::text[])
    `.execute(trx);
    for (const row of rows.rows) costIds.add(row.id);
  }
  await deleteSpikeTableRows(trx, "costLedger", companyId, "id", [...costIds]);

  await deleteCompanyRows(trx, "itemLedger", companyId, "id", ledgerIds);
}

async function collectTrackedEntityIds(
  trx: Trx,
  companyId: string,
  likePrefix: string,
  itemIds: string[],
  jobIds: string[]
) {
  const ids = new Set<string>();
  const prefixRows = await trx
    .selectFrom("trackedEntity")
    .select("id")
    .where("companyId", "=", companyId)
    .where((eb) =>
      eb.or([
        eb("id", "like", likePrefix),
        eb("readableId", "like", likePrefix),
        ...(itemIds.length > 0 ? [eb("itemId", "in", itemIds)] : [])
      ])
    )
    .execute();
  for (const row of prefixRows) ids.add(row.id);

  if (jobIds.length > 0) {
    const { rows: byJobAttr } = await sql<{ id: string }>`
      SELECT id FROM "trackedEntity"
      WHERE "companyId" = ${companyId}
        AND attributes->>'Job' = ANY(${jobIds}::text[])
    `.execute(trx);
    for (const row of byJobAttr) ids.add(row.id);

    const { rows: byJmm } = await sql<{ id: string }>`
      SELECT te.id
      FROM "trackedEntity" te
      INNER JOIN "jobMakeMethod" jmm
        ON jmm.id = te.attributes->>'Job Make Method'
       AND jmm."companyId" = te."companyId"
      WHERE te."companyId" = ${companyId}
        AND jmm."jobId" = ANY(${jobIds}::text[])
    `.execute(trx);
    for (const row of byJmm) ids.add(row.id);
  }

  return [...ids];
}

type SpikeItemRow = {
  id: string;
  readableId: string | null;
  type: string;
};

async function querySpikeOwnedItems(
  trx: Trx,
  companyId: string,
  prefix: string
): Promise<SpikeItemRow[]> {
  const likePrefix = `${prefix}%`;
  // BULK-/FG- SKUs are shared by formula ref across prefixes (spike vs product-seed).
  return trx
    .selectFrom("item")
    .select(["id", "readableId", "type"])
    .where("companyId", "=", companyId)
    .where((eb) =>
      eb.or([eb("readableId", "like", likePrefix), eb("id", "like", likePrefix)])
    )
    .execute();
}

function deletableSpikeItemIds(items: SpikeItemRow[]): string[] {
  return items
    .filter((row) => row.type !== "Material")
    .map((row) => row.id);
}

function spikePartNumbers(items: SpikeItemRow[]): string[] {
  return items
    .filter((row) => row.type === "Part" && row.readableId != null)
    .map((row) => row.readableId as string);
}

/** Drop every spike artifact for this tag (readableId prefix and legacy id prefix). */
export async function teardownTagged(
  db: Db,
  companyId: string,
  prefix: string
): Promise<void> {
  await runTeardownTrx(db, async (trx) => {
    const likePrefix = `${prefix}%`;

    const seedItemIds = await teardownStep(trx, "discover-items", async () => {
      const rows = await querySpikeOwnedItems(trx, companyId, prefix);
      return deletableSpikeItemIds(rows);
    });

    const jobIds = await teardownStep(trx, "discover-jobs", async () => {
      const jobRows = await trx
        .selectFrom("job")
        .select("id")
        .where("companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb("jobId", "like", likePrefix),
            eb("id", "like", likePrefix),
            ...(seedItemIds.length > 0 ? [eb("itemId", "in", seedItemIds)] : [])
          ])
        )
        .execute();
      return jobRows.map((r) => r.id);
    });

    const { itemIds, partNumbers } = await teardownStep(
      trx,
      "discover-items-with-jobs",
      async () => {
        const idSet = new Set(seedItemIds);
        if (jobIds.length > 0) {
          const jobItems = await trx
            .selectFrom("job")
            .select("itemId")
            .where("companyId", "=", companyId)
            .where("id", "in", jobIds)
            .execute();
          for (const row of jobItems) idSet.add(row.itemId);
        }
        const byId =
          idSet.size > 0
            ? await trx
                .selectFrom("item")
                .select(["id", "readableId", "type"])
                .where("companyId", "=", companyId)
                .where("id", "in", [...idSet])
                .execute()
            : await querySpikeOwnedItems(trx, companyId, prefix);
        return {
          itemIds: deletableSpikeItemIds(byId),
          partNumbers: spikePartNumbers(byId)
        };
      }
    );

    const jobOpIds = await teardownStep(trx, "discover-job-operations", async () => {
      if (jobIds.length === 0) return [];
      const jobOpRows = await trx
        .selectFrom("jobOperation")
        .select("id")
        .where("companyId", "=", companyId)
        .where("jobId", "in", jobIds)
        .execute();
      return jobOpRows.map((r) => r.id);
    });

    const salesOrderIds = await teardownStep(trx, "discover-sales-orders", async () => {
      const salesOrders = await trx
        .selectFrom("salesOrder")
        .select("id")
        .where("companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb("id", "like", likePrefix),
            eb("salesOrderId", "like", likePrefix)
          ])
        )
        .execute();
      return salesOrders.map((r) => r.id);
    });

    const shipmentIds = await teardownStep(trx, "discover-shipments", async () => {
      const shipmentRows = await trx
        .selectFrom("shipment")
        .select("id")
        .where("companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb("id", "like", likePrefix),
            eb("shipmentId", "like", likePrefix),
            ...(salesOrderIds.length > 0
              ? [
                  eb.and([
                    eb("sourceDocument", "=", "Sales Order"),
                    eb("sourceDocumentId", "in", salesOrderIds)
                  ])
                ]
              : [])
          ])
        )
        .execute();
      return shipmentRows.map((r) => r.id);
    });

    const trackedEntityIds = await teardownStep(
      trx,
      "discover-tracked-entities",
      async () =>
        collectTrackedEntityIds(trx, companyId, likePrefix, itemIds, jobIds)
    );

    await teardownStep(trx, "delete-shipments", async () => {
      if (shipmentIds.length === 0) return;
      await trx
        .updateTable("shipment")
        .set({ status: "Draft", postedBy: null, postingDate: null })
        .where("companyId", "=", companyId)
        .where("id", "in", shipmentIds)
        .execute();
      await deleteCompanyRows(
        trx,
        "shipmentLine",
        companyId,
        "shipmentId",
        shipmentIds
      );
      await deleteCompanyRows(trx, "shipment", companyId, "id", shipmentIds);
    });

    await teardownStep(trx, "delete-job-mes-rows", async () => {
      if (jobIds.length === 0 || jobOpIds.length === 0) return;
      await deleteCompanyRows(
        trx,
        "productionQuantity",
        companyId,
        "jobOperationId",
        jobOpIds
      );
      await deleteCompanyRows(
        trx,
        "productionEvent",
        companyId,
        "jobOperationId",
        jobOpIds
      );
      await deleteCompanyRows(
        trx,
        "jobOperationTrackedEntity",
        companyId,
        "jobOperationId",
        jobOpIds
      );
    });

    await teardownStep(trx, "delete-journals", async () => {
      const docIds = [...jobIds, ...shipmentIds];
      const ledgerScope = await trx
        .selectFrom("itemLedger")
        .select("id")
        .where("companyId", "=", companyId)
        .where((eb) => {
          const parts = [];
          if (itemIds.length > 0) parts.push(eb("itemId", "in", itemIds));
          if (jobIds.length > 0) parts.push(eb("documentId", "in", jobIds));
          if (shipmentIds.length > 0) {
            parts.push(eb("documentId", "in", shipmentIds));
          }
          return parts.length > 0 ? eb.or(parts) : eb.val(false);
        })
        .execute();
      await deleteSpikeJournals(trx, companyId, [
        ...docIds,
        ...ledgerScope.map((r) => r.id)
      ]);
    });

    await teardownStep(trx, "delete-tracked-activity", async () => {
      await deleteTrackedActivityGraph(
        trx,
        companyId,
        jobOpIds,
        trackedEntityIds
      );
    });

    await teardownStep(trx, "delete-ledgers-for-jobs", async () => {
      await deleteSpikeLedgers(
        trx,
        companyId,
        itemIds,
        jobIds,
        shipmentIds,
        trackedEntityIds
      );
    });

    await teardownStep(trx, "delete-jobs", async () => {
      if (jobIds.length === 0) return;
      await deleteJobGraph(trx, companyId, jobIds, jobOpIds);
    });

    await teardownStep(trx, "delete-dispense-by-prefix", async () => {
      await deleteSpikeTableLike(
        trx,
        "skuuJobMaterialDispense",
        companyId,
        "id",
        likePrefix
      );
    });

    await teardownStep(trx, "delete-tracked-entities", async () => {
      if (trackedEntityIds.length > 0) {
        await deleteCompanyRows(
          trx,
          "trackedEntity",
          companyId,
          "id",
          trackedEntityIds
        );
      } else if (itemIds.length > 0) {
        await trx
          .deleteFrom("trackedEntity")
          .where("companyId", "=", companyId)
          .where((eb) =>
            eb.or([
              eb("itemId", "in", itemIds),
              eb("id", "like", likePrefix),
              eb("readableId", "like", likePrefix)
            ])
          )
          .execute();
      } else {
        await trx
          .deleteFrom("trackedEntity")
          .where("companyId", "=", companyId)
          .where((eb) =>
            eb.or([
              eb("id", "like", likePrefix),
              eb("readableId", "like", likePrefix)
            ])
          )
          .execute();
      }
    });

    await teardownStep(trx, "delete-sales-orders", async () => {
      if (salesOrderIds.length === 0) return;
      await trx
        .deleteFrom("salesOrderLine")
        .where("companyId", "=", companyId)
        .where("salesOrderId", "in", salesOrderIds)
        .execute();
      await trx
        .deleteFrom("salesOrderShipment")
        .where("companyId", "=", companyId)
        .where("id", "in", salesOrderIds)
        .execute();
      await trx
        .deleteFrom("salesOrder")
        .where("companyId", "=", companyId)
        .where("id", "in", salesOrderIds)
        .execute();
    });

    await teardownStep(trx, "delete-make-methods", async () => {
      const makeMethods = await trx
        .selectFrom("makeMethod")
        .select("id")
        .where("companyId", "=", companyId)
        .where((eb) =>
          eb.or([
            eb("id", "like", likePrefix),
            itemIds.length > 0
              ? eb("itemId", "in", itemIds)
              : eb("id", "like", likePrefix)
          ])
        )
        .execute();

      for (const { id: makeMethodId } of makeMethods) {
        const methodMaterialIds = await trx
          .selectFrom("methodMaterial")
          .select("id")
          .where("makeMethodId", "=", makeMethodId)
          .execute();
        const mmIds = methodMaterialIds.map((r) => r.id);
        if (mmIds.length > 0) {
          await trx
            .deleteFrom("skuuMethodMaterialFormula")
            .where("companyId", "=", companyId)
            .where("methodMaterialId", "in", mmIds)
            .execute();
        }
        await trx
          .deleteFrom("skuuMakeMethodBulk")
          .where("makeMethodId", "=", makeMethodId)
          .execute();
        await sql`
          DELETE FROM "skuuFormulaPhase"
          WHERE "makeMethodId" = ${makeMethodId}
        `.execute(trx);
        await trx
          .deleteFrom("methodMaterial")
          .where("makeMethodId", "=", makeMethodId)
          .execute();
        await trx
          .deleteFrom("methodOperation")
          .where("makeMethodId", "=", makeMethodId)
          .execute();
        await trx.deleteFrom("makeMethod").where("id", "=", makeMethodId).execute();
      }
    });

    await teardownStep(trx, "delete-processes", async () => {
      const candidates = await trx
        .selectFrom("process")
        .select("id")
        .where("companyId", "=", companyId)
        .where("id", "like", likePrefix)
        .execute();
      for (const { id: processId } of candidates) {
        const stillUsed = await trx
          .selectFrom("methodOperation")
          .select("id")
          .where("companyId", "=", companyId)
          .where("processId", "=", processId)
          .limit(1)
          .executeTakeFirst();
        if (!stillUsed) {
          await trx
            .deleteFrom("process")
            .where("companyId", "=", companyId)
            .where("id", "=", processId)
            .execute();
        }
      }
    });

    await teardownStep(trx, "delete-items", async () => {
      if (itemIds.length === 0) {
        await trx
          .deleteFrom("item")
          .where("companyId", "=", companyId)
          .where("id", "like", likePrefix)
          .execute();
        return;
      }
      await deleteSpikeLedgers(trx, companyId, itemIds, [], [], []);
      if (partNumbers.length > 0) {
        await trx
          .deleteFrom("part")
          .where("companyId", "=", companyId)
          .where("id", "in", partNumbers)
          .execute();
      }
      for (const table of [
        "itemUnitSalePrice",
        "itemPlanning",
        "itemReplenishment",
        "itemCost",
        "pickMethod",
        "itemShelfLife"
      ] as const) {
        await trx
          .deleteFrom(table)
          .where("companyId", "=", companyId)
          .where("itemId", "in", itemIds)
          .execute();
      }
      await trx
        .deleteFrom("item")
        .where("companyId", "=", companyId)
        .where("id", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("item")
        .where("companyId", "=", companyId)
        .where("id", "like", likePrefix)
        .execute();
    });
  });
}