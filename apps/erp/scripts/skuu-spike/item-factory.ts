// SPDX-License-Identifier: AGPL-3.0-only

import { upsertPart } from "~/modules/items/items.service";
import type { SpikeContext } from "./context";

type EnsurePartInput = {
  name: string;
  replenishmentSystem: "Buy" | "Make";
  itemTrackingType: "Batch";
  unitOfMeasureCode: string;
  unitCost?: number;
};

/** Same path as createPart / the new-part form: PostgREST insert so item interceptors run (itemCost, itemReplenishment, itemPlanning, …). */
export async function ensureSpikePart(
  ctx: SpikeContext,
  readableId: string,
  input: EnsurePartInput
): Promise<string> {
  const existing = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", readableId)
    .executeTakeFirst();
  if (existing) return existing.id;

  const client = ctx.service.asSystem.supabase;
  if (!client) {
    throw new Error("PostgREST client required for upsertPart (crbn up / PORT_API).");
  }

  const defaultMethodType =
    input.replenishmentSystem === "Buy" ? "Purchase to Order" : "Make to Order";

  const created = await upsertPart(client, {
    id: readableId,
    name: input.name,
    revision: "0",
    replenishmentSystem: input.replenishmentSystem,
    defaultMethodType,
    itemTrackingType: input.itemTrackingType,
    unitOfMeasureCode: input.unitOfMeasureCode,
    unitCost:
      input.replenishmentSystem === "Buy"
        ? (input.unitCost ?? 1)
        : undefined,
    shelfLifeCalculateFromBom: false,
    companyId: ctx.companyId,
    createdBy: ctx.userId
  });

  if (created.error) {
    throw new Error(
      `upsertPart failed for ${readableId}: ${created.error.message}`
    );
  }

  const row = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", readableId)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`Item ${readableId} missing after upsertPart`);
  }
  return row.id;
}