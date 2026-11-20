// SPDX-License-Identifier: AGPL-3.0-only

import { upsertMaterial, upsertPart } from "~/modules/items/items.service";
import type { SpikeContext } from "./context";
import {
  resolveSpikeMaterialLookups,
  retargetMaterialReadableId
} from "./spike-material-lookups";
import { spikeAuthHint } from "./supabase-local";

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
      spikeAuthHint(`upsertPart failed for ${readableId}: ${created.error.message}`)
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

type EnsureMaterialInput = {
  name: string;
  unitOfMeasureCode: string;
  unitCost?: number;
};

/** Shared buy material by real part code (readableId); never scoped per formula. */
export async function ensureSpikeMaterial(
  ctx: SpikeContext,
  partCode: string,
  input: EnsureMaterialInput
): Promise<string> {
  const existing = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", partCode)
    .executeTakeFirst();
  if (existing) return existing.id;

  const client = ctx.service.asSystem.supabase;
  if (!client) {
    throw new Error("PostgREST client required for upsertMaterial (crbn up / PORT_API).");
  }

  const lookups = await resolveSpikeMaterialLookups(ctx);

  const materialPayload = {
    id: partCode,
    name: input.name,
    replenishmentSystem: "Buy" as const,
    defaultMethodType: "Purchase to Order" as const,
    itemTrackingType: "Batch" as const,
    unitOfMeasureCode: input.unitOfMeasureCode,
    unitCost: input.unitCost ?? 1,
    companyId: ctx.companyId,
    createdBy: ctx.userId,
    ...(lookups.materialGeneratedIds
      ? {
          materialSubstanceId: lookups.materialSubstanceId,
          materialFormId: lookups.materialFormId
        }
      : {})
  };

  const created = await upsertMaterial(client, ctx.db, materialPayload);

  if (created.error) {
    throw new Error(
      spikeAuthHint(`upsertMaterial failed for ${partCode}: ${created.error.message}`)
    );
  }

  const assignedReadableId =
    (created.data as { readableId?: string } | null)?.readableId ?? partCode;
  if (lookups.materialGeneratedIds && assignedReadableId !== partCode) {
    await retargetMaterialReadableId(ctx, assignedReadableId, partCode);
  }

  const row = await ctx.db
    .selectFrom("item")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("readableId", "=", partCode)
    .executeTakeFirst();
  if (!row) {
    throw new Error(`Material ${partCode} missing after upsertMaterial`);
  }
  return row.id;
}