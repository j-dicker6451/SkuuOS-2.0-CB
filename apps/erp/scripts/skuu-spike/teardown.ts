// SPDX-License-Identifier: AGPL-3.0-only

import { sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";

type Db = Kysely<KyselyDatabase>;
type Trx = Transaction<KyselyDatabase>;

async function runTeardownTrx<T>(
  db: Db,
  fn: (trx: Trx) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    try {
      return await fn(trx);
    } finally {
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    }
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
    | "skuuJobMaterialDispense"
    | "jobMaterial"
    | "jobOperationStep"
    | "jobOperation"
    | "jobMakeMethod"
    | "job"
    | "costLedger"
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
    | "jobOperationId"
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

async function deleteSpikeJournals(
  trx: Trx,
  companyId: string,
  jobIds: string[],
  shipmentIds: string[]
) {
  const sourceIds = [...jobIds, ...shipmentIds];
  if (sourceIds.length === 0) return;
  const journals = await trx
    .selectFrom("journal")
    .select("id")
    .where("companyId", "=", companyId)
    .where("sourceDocumentId", "in", sourceIds)
    .execute();
  const journalIds = journals.map((r) => r.id);
  if (journalIds.length === 0) return;
  const lineIds = (
    await trx
      .selectFrom("journalLine")
      .select("id")
      .where("companyId", "=", companyId)
      .where("journalId", "in", journalIds)
      .execute()
  ).map((r) => r.id);
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
  jobIds: string[],
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

  if (jobIds.length > 0) {
    const { rows } = await sql<{ id: string }>`
      SELECT id FROM "trackedActivity"
      WHERE "companyId" = ${companyId}
        AND attributes->>'Job' = ANY(${jobIds}::text[])
    `.execute(trx);
    for (const row of rows) activityIdSet.add(row.id);
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

  await deleteCompanyRows(trx, "costLedger", companyId, "documentId", ledgerIds);
  if (itemIds.length > 0) {
    await trx
      .deleteFrom("costLedger")
      .where("companyId", "=", companyId)
      .where("itemId", "in", itemIds)
      .execute();
  }
  await deleteCompanyRows(trx, "itemLedger", companyId, "id", ledgerIds);
}

/** Drop every spike artifact for this tag (readableId prefix and legacy id prefix). */
export async function teardownTagged(
  db: Db,
  companyId: string,
  prefix: string
): Promise<void> {
  await runTeardownTrx(db, async (trx) => {
    const likePrefix = `${prefix}%`;

    const spikeItems = await trx
      .selectFrom("item")
      .select(["id", "readableId"])
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("readableId", "like", likePrefix),
          eb("id", "like", likePrefix)
        ])
      )
      .execute();
    const itemIds = spikeItems.map((r) => r.id);
    const partNumbers = spikeItems
      .map((r) => r.readableId)
      .filter((id): id is string => id != null);

    const jobRows = await trx
      .selectFrom("job")
      .select("id")
      .where("companyId", "=", companyId)
      .where((eb) =>
        eb.or([
          eb("jobId", "like", likePrefix),
          eb("id", "like", likePrefix),
          ...(itemIds.length > 0 ? [eb("itemId", "in", itemIds)] : [])
        ])
      )
      .execute();
    const jobIds = jobRows.map((r) => r.id);

    const jobOpRows =
      jobIds.length > 0
        ? await trx
            .selectFrom("jobOperation")
            .select("id")
            .where("companyId", "=", companyId)
            .where("jobId", "in", jobIds)
            .execute()
        : [];
    const jobOpIds = jobOpRows.map((r) => r.id);

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
    const salesOrderIds = salesOrders.map((r) => r.id);

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
    const shipmentIds = shipmentRows.map((r) => r.id);

    const trackedEntityRows = await trx
      .selectFrom("trackedEntity")
      .select("id")
      .where("companyId", "=", companyId)
      .where((eb) => {
        const parts = [
          eb("id", "like", likePrefix),
          eb("readableId", "like", likePrefix)
        ];
        if (itemIds.length > 0) {
          parts.push(eb("itemId", "in", itemIds));
        }
        if (jobIds.length > 0) {
          parts.push(sql`attributes->>'Job' = ANY(${jobIds}::text[])`);
        }
        return eb.or(parts);
      })
      .execute();
    const trackedEntityIds = trackedEntityRows.map((r) => r.id);

    if (shipmentIds.length > 0) {
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
    }

    if (jobIds.length > 0) {
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

      const jobMaterialIds = (
        await trx
          .selectFrom("jobMaterial")
          .select("id")
          .where("companyId", "=", companyId)
          .where("jobId", "in", jobIds)
          .execute()
      ).map((r) => r.id);

      if (jobMaterialIds.length > 0) {
        const chunk = 200;
        for (let i = 0; i < jobMaterialIds.length; i += chunk) {
          const slice = jobMaterialIds.slice(i, i + chunk);
          await trx
            .deleteFrom("jobMaterialStep")
            .where("jobMaterialId", "in", slice)
            .execute();
        }
        await deleteCompanyRows(
          trx,
          "jobMaterialScrap",
          companyId,
          "jobMaterialId",
          jobMaterialIds
        );
        await deleteCompanyRows(
          trx,
          "skuuJobMaterialDispense",
          companyId,
          "jobMaterialId",
          jobMaterialIds
        );
      }

      await deleteSpikeJournals(trx, companyId, jobIds, shipmentIds);
      await deleteTrackedActivityGraph(
        trx,
        companyId,
        jobIds,
        jobOpIds,
        trackedEntityIds
      );
      await deleteSpikeLedgers(
        trx,
        companyId,
        itemIds,
        jobIds,
        shipmentIds,
        trackedEntityIds
      );

      await deleteCompanyRows(trx, "jobMaterial", companyId, "jobId", jobIds);
      await deleteCompanyRows(
        trx,
        "jobOperationStep",
        companyId,
        "jobOperationId",
        jobOpIds
      );
      await deleteCompanyRows(trx, "jobOperation", companyId, "jobId", jobIds);
      await deleteCompanyRows(trx, "jobMakeMethod", companyId, "jobId", jobIds);
      await deleteCompanyRows(trx, "job", companyId, "id", jobIds);
    }

    await trx
      .deleteFrom("skuuJobMaterialDispense")
      .where("companyId", "=", companyId)
      .where("id", "like", likePrefix)
      .execute();

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

    for (const { id: salesOrderId } of salesOrders) {
      await trx
        .deleteFrom("salesOrderLine")
        .where("salesOrderId", "=", salesOrderId)
        .execute();
      await trx
        .deleteFrom("salesOrderShipment")
        .where("id", "=", salesOrderId)
        .execute();
      await trx.deleteFrom("salesOrder").where("id", "=", salesOrderId).execute();
    }

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
          .where("methodMaterialId", "in", mmIds)
          .execute();
      }
      await trx
        .deleteFrom("skuuMakeMethodBulk")
        .where("makeMethodId", "=", makeMethodId)
        .execute();
      await trx
        .deleteFrom("skuuFormulaPhase")
        .where("makeMethodId", "=", makeMethodId)
        .execute();
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

    await trx
      .deleteFrom("process")
      .where("companyId", "=", companyId)
      .where("id", "like", likePrefix)
      .execute();

    if (itemIds.length > 0) {
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
    }

    await trx
      .deleteFrom("item")
      .where("companyId", "=", companyId)
      .where("id", "like", likePrefix)
      .execute();
  });
}