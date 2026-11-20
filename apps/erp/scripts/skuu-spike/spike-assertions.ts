// SPDX-License-Identifier: AGPL-3.0-only

import type { SpikeContext } from "./context";

/** Raw ingredients must be Buy/Batch kg Materials created via upsertMaterial. */
export async function assertSpikeRawMaterials(
  ctx: SpikeContext,
  materialItemIds: string[]
): Promise<void> {
  if (materialItemIds.length === 0) return;
  const items = await ctx.db
    .selectFrom("item")
    .select(["id", "readableId", "type", "replenishmentSystem", "itemTrackingType", "unitOfMeasureCode"])
    .where("companyId", "=", ctx.companyId)
    .where("id", "in", materialItemIds)
    .execute();

  const byId = new Map(items.map((row) => [row.id, row]));
  for (const id of materialItemIds) {
    const row = byId.get(id);
    if (!row) {
      throw new Error(`Raw ingredient item id ${id} not found`);
    }
    if (row.type !== "Material") {
      throw new Error(
        `Raw ingredient ${row.readableId ?? id} has type ${row.type}; expected Material (Buy, Batch, kg via upsertMaterial)`
      );
    }
    if (row.replenishmentSystem !== "Buy") {
      throw new Error(
        `Raw ingredient ${row.readableId ?? id}: replenishmentSystem ${row.replenishmentSystem}, expected Buy`
      );
    }
    if (row.itemTrackingType !== "Batch") {
      throw new Error(
        `Raw ingredient ${row.readableId ?? id}: tracking ${row.itemTrackingType}, expected Batch`
      );
    }
    if (row.unitOfMeasureCode !== ctx.lookups.unitKg) {
      throw new Error(
        `Raw ingredient ${row.readableId ?? id}: UoM ${row.unitOfMeasureCode}, expected ${ctx.lookups.unitKg}`
      );
    }
    const materialRow = await ctx.db
      .selectFrom("material")
      .select("id")
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", row.id)
      .executeTakeFirst();
    if (!materialRow) {
      throw new Error(
        `Raw ingredient ${row.readableId ?? id} has no material row (Carbon Material create path)`
      );
    }
  }
}