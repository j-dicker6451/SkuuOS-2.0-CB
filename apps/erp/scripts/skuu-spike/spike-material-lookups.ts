// SPDX-License-Identifier: AGPL-3.0-only

import type { SpikeContext } from "./context";

export type SpikeMaterialLookups = {
  materialGeneratedIds: boolean;
};

export async function resolveSpikeMaterialLookups(
  ctx: SpikeContext
): Promise<SpikeMaterialLookups> {
  const settings = await ctx.db
    .selectFrom("companySettings")
    .select("materialGeneratedIds")
    .where("id", "=", ctx.companyId)
    .executeTakeFirst();
  return {
    materialGeneratedIds: settings?.materialGeneratedIds === true
  };
}

/** Trade name from spike/json — not Carbon's generated substance+shape label. */
export async function backfillSpikeMaterialTradeName(
  ctx: SpikeContext,
  itemId: string,
  partCode: string,
  tradeName: string
): Promise<void> {
  const row = await ctx.db
    .selectFrom("item")
    .select(["id", "name", "readableId", "description"])
    .where("companyId", "=", ctx.companyId)
    .where("id", "=", itemId)
    .executeTakeFirst();
  if (!row) return;

  const now = new Date().toISOString();
  const updates: Record<string, string> = {
    updatedBy: ctx.userId,
    updatedAt: now
  };
  if (row.name !== tradeName) updates.name = tradeName;
  if (row.description !== tradeName) updates.description = tradeName;

  if (Object.keys(updates).length <= 2) return;

  await ctx.db
    .updateTable("item")
    .set(updates)
    .where("companyId", "=", ctx.companyId)
    .where("id", "=", itemId)
    .execute();
}

/** Legacy spike path when materialGeneratedIds was still enabled. */
export async function retargetMaterialReadableId(
  ctx: SpikeContext,
  generatedReadableId: string,
  partCode: string,
  tradeName: string
): Promise<void> {
  if (generatedReadableId === partCode) return;

  const conflict = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", partCode)
    .executeTakeFirst();
  if (conflict) {
    throw new Error(
      `Cannot retarget material to ${partCode}: readableId already in use`
    );
  }

  const item = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", generatedReadableId)
    .where("type", "=", "Material")
    .executeTakeFirst();
  if (!item) {
    throw new Error(
      `Retarget material: item ${generatedReadableId} not found after upsertMaterial`
    );
  }

  const matRow = await ctx.db
    .selectFrom("material")
    .selectAll()
    .where("companyId", "=", ctx.companyId)
    .where("id", "=", generatedReadableId)
    .executeTakeFirst();
  if (!matRow) {
    throw new Error(
      `Retarget material: material row ${generatedReadableId} missing`
    );
  }

  const now = new Date().toISOString();
  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("item")
      .set({
        readableId: partCode,
        name: tradeName,
        description: tradeName,
        updatedBy: ctx.userId,
        updatedAt: now
      })
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", item.id)
      .execute();
    await trx
      .deleteFrom("material")
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", generatedReadableId)
      .execute();
    await trx
      .insertInto("material")
      .values({
        id: partCode,
        companyId: ctx.companyId,
        materialSubstanceId: null,
        materialFormId: null,
        materialTypeId: matRow.materialTypeId,
        finishId: matRow.finishId,
        gradeId: matRow.gradeId,
        dimensionId: matRow.dimensionId,
        approved: matRow.approved,
        approvedBy: matRow.approvedBy,
        customFields: matRow.customFields,
        tags: matRow.tags,
        createdBy: matRow.createdBy,
        updatedBy: ctx.userId,
        createdAt: matRow.createdAt,
        updatedAt: now
      })
      .execute();
  });
}