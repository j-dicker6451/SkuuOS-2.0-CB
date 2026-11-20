// SPDX-License-Identifier: AGPL-3.0-only

import type { SpikeContext } from "./context";
import type { SpikeIngredient } from "./context";
import { resolveIngredientPartCode } from "./spike-codes";
import { backfillSpikeMaterialTradeName } from "./spike-material-lookups";

/** Skuu companies use manual material IDs and trade names, not substance+shape names. */
export async function ensureSkuuCompanyMaterialDefaults(
  ctx: SpikeContext
): Promise<void> {
  await ctx.db
    .updateTable("companySettings")
    .set({
      materialGeneratedIds: false
    })
    .where("id", "=", ctx.companyId)
    .execute();
}

export async function unlinkSkuuIngredientsFromMetalworkShape(
  ctx: SpikeContext,
  ingredients: SpikeIngredient[]
): Promise<void> {
  const now = new Date().toISOString();
  const partCodes = [
    ...new Set(ingredients.map((i) => resolveIngredientPartCode(i)))
  ];
  for (const code of partCodes) {
    await ctx.db
      .updateTable("material")
      .set({
        materialSubstanceId: null,
        materialFormId: null,
        materialTypeId: null,
        updatedBy: ctx.userId,
        updatedAt: now
      })
      .where("companyId", "=", ctx.companyId)
      .where("id", "=", code)
      .execute();

    const item = await ctx.db
      .selectFrom("item")
      .select("id")
      .where("companyId", "=", ctx.companyId)
      .where("readableId", "=", code)
      .where("type", "=", "Material")
      .executeTakeFirst();
    if (!item) continue;

    const ing = ingredients.find(
      (i) => resolveIngredientPartCode(i) === code
    );
    if (ing) {
      await backfillSpikeMaterialTradeName(ctx, item.id, code, ing.name);
      await ctx.db
        .updateTable("item")
        .set({
          description: ing.name,
          updatedBy: ctx.userId,
          updatedAt: now
        })
        .where("id", "=", item.id)
        .execute();
    }
  }
}