// SPDX-License-Identifier: AGPL-3.0-only

import { sql, type Transaction } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";

type Db = Kysely<KyselyDatabase>;

async function runTeardownTrx<T>(
  db: Db,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL session_replication_role = replica`.execute(trx);
    try {
      return await fn(trx);
    } finally {
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
    }
  });
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
      .where("id", "like", likePrefix)
      .execute();
    const jobIds = jobRows.map((r) => r.id);

    if (jobIds.length > 0) {
      const jobMaterialIds = await trx
        .selectFrom("jobMaterial")
        .select("id")
        .where("companyId", "=", companyId)
        .where("jobId", "in", jobIds)
        .execute();
      const jmIds = jobMaterialIds.map((r) => r.id);
      if (jmIds.length > 0) {
        await trx
          .deleteFrom("skuuJobMaterialDispense")
          .where("companyId", "=", companyId)
          .where("jobMaterialId", "in", jmIds)
          .execute();
      }
      await trx
        .deleteFrom("jobMaterial")
        .where("companyId", "=", companyId)
        .where("jobId", "in", jobIds)
        .execute();
      await trx
        .deleteFrom("jobOperation")
        .where("companyId", "=", companyId)
        .where("jobId", "in", jobIds)
        .execute();
      await trx
        .deleteFrom("jobMakeMethod")
        .where("companyId", "=", companyId)
        .where("jobId", "in", jobIds)
        .execute();
      await trx
        .deleteFrom("job")
        .where("companyId", "=", companyId)
        .where("id", "in", jobIds)
        .execute();
    }

    await trx
      .deleteFrom("skuuJobMaterialDispense")
      .where("companyId", "=", companyId)
      .where("id", "like", likePrefix)
      .execute();

    if (itemIds.length > 0) {
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
          itemIds.length > 0 ? eb("itemId", "in", itemIds) : eb("id", "like", likePrefix)
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
      if (partNumbers.length > 0) {
        await trx
          .deleteFrom("part")
          .where("companyId", "=", companyId)
          .where("id", "in", partNumbers)
          .execute();
      }
      await trx
        .deleteFrom("itemUnitSalePrice")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("itemPlanning")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("itemReplenishment")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("itemCost")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("pickMethod")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
      await trx
        .deleteFrom("itemShelfLife")
        .where("companyId", "=", companyId)
        .where("itemId", "in", itemIds)
        .execute();
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