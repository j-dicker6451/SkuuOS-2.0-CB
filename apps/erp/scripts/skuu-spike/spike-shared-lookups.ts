// SPDX-License-Identifier: AGPL-3.0-only

import type { Transaction } from "kysely";
import type { KyselyDatabase } from "@carbon/database/client";
import type { SpikeContext } from "./context";

type Trx = Transaction<KyselyDatabase>;

/** Company-wide process by name — reused across spike / product-seed prefixes. */
export async function ensureSpikeProcess(
  trx: Trx,
  ctx: SpikeContext,
  name: string,
  preferredId: string
): Promise<string> {
  const existing = await trx
    .selectFrom("process")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("name", "=", name)
    .executeTakeFirst();
  if (existing) return existing.id;

  await trx
    .insertInto("process")
    .values({
      id: preferredId,
      name,
      defaultStandardFactor: ctx.lookups.standardFactor,
      companyId: ctx.companyId,
      createdBy: ctx.userId
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  const row = await trx
    .selectFrom("process")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("name", "=", name)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`ensureSpikeProcess: could not resolve process "${name}"`);
  }
  return row.id;
}

export async function ensureSpikeMethodOperation(
  trx: Trx,
  ctx: SpikeContext,
  makeMethodId: string,
  processId: string,
  description: string,
  preferredId: string
): Promise<string> {
  const existing = await trx
    .selectFrom("methodOperation")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("processId", "=", processId)
    .where("description", "=", description)
    .executeTakeFirst();
  if (existing) return existing.id;

  await trx
    .insertInto("methodOperation")
    .values({
      id: preferredId,
      makeMethodId,
      processId,
      description,
      companyId: ctx.companyId,
      createdBy: ctx.userId
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  const row = await trx
    .selectFrom("methodOperation")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("processId", "=", processId)
    .where("description", "=", description)
    .executeTakeFirst();
  if (!row) {
    throw new Error(
      `ensureSpikeMethodOperation: missing op ${description} on makeMethod ${makeMethodId}`
    );
  }
  return row.id;
}

export async function ensureSpikeMethodMaterialId(
  trx: Trx,
  ctx: SpikeContext,
  makeMethodId: string,
  methodOperationId: string,
  itemId: string,
  preferredId: string
): Promise<string> {
  const existing = await trx
    .selectFrom("methodMaterial")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("itemId", "=", itemId)
    .executeTakeFirst();
  if (existing) return existing.id;

  await trx
    .insertInto("methodMaterial")
    .values({
      id: preferredId,
      makeMethodId,
      methodOperationId,
      itemId,
      itemType: "Material",
      methodType: "Pull from Inventory",
      quantity: 0,
      unitOfMeasureCode: ctx.lookups.unitKg,
      companyId: ctx.companyId,
      createdBy: ctx.userId
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();

  const row = await trx
    .selectFrom("methodMaterial")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("itemId", "=", itemId)
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function ensureSpikeFillMethodMaterial(
  trx: Trx,
  ctx: SpikeContext,
  makeMethodId: string,
  methodOperationId: string,
  bulkItemId: string,
  kgPerUnit: number,
  preferredId: string
): Promise<string> {
  const existing = await trx
    .selectFrom("methodMaterial")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("itemId", "=", bulkItemId)
    .executeTakeFirst();
  if (existing) {
    await trx
      .updateTable("methodMaterial")
      .set({
        quantity: kgPerUnit,
        methodOperationId,
        updatedBy: ctx.userId,
        updatedAt: new Date().toISOString()
      })
      .where("id", "=", existing.id)
      .where("companyId", "=", ctx.companyId)
      .execute();
    return existing.id;
  }

  await trx
    .insertInto("methodMaterial")
    .values({
      id: preferredId,
      makeMethodId,
      methodOperationId,
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

  const row = await trx
    .selectFrom("methodMaterial")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("makeMethodId", "=", makeMethodId)
    .where("itemId", "=", bulkItemId)
    .executeTakeFirstOrThrow();
  return row.id;
}