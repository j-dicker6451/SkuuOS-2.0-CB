// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import { upsertMaterialForm, upsertMaterialSubstance } from "~/modules/items/items.service";
import type { SpikeContext } from "./context";
import { spikeAuthHint } from "./supabase-local";

/** Idempotent Skuu spike lookups — match ERP Material form substance + shape. */
export const SKUU_SPIKE_SUBSTANCE_ID = "skuu-cosmetic-raw";
export const SKUU_SPIKE_FORM_ID = "skuu-cosmetic-bulk";

export type SpikeMaterialLookups = {
  materialGeneratedIds: boolean;
  materialSubstanceId: string;
  materialFormId: string;
};

export async function resolveSpikeMaterialLookups(
  ctx: SpikeContext
): Promise<SpikeMaterialLookups> {
  const settings = await ctx.db
    .selectFrom("companySettings")
    .select("materialGeneratedIds")
    .where("id", "=", ctx.companyId)
    .executeTakeFirst();
  const materialGeneratedIds = settings?.materialGeneratedIds === true;

  const client = ctx.service.asSystem.supabase;
  if (!client) {
    throw new Error("PostgREST required for material substance/shape setup.");
  }

  const existingSubstance = await client
    .from("materialSubstance")
    .select("id")
    .eq("id", SKUU_SPIKE_SUBSTANCE_ID)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (!existingSubstance.data) {
    const ins = await upsertMaterialSubstance(client, {
      id: SKUU_SPIKE_SUBSTANCE_ID,
      name: "Cosmetic raw material",
      code: "COSRAW",
      companyId: ctx.companyId,
      createdBy: ctx.userId
    });
    if (ins.error && !ins.error.message.includes("duplicate")) {
      throw new Error(spikeAuthHint(`materialSubstance: ${ins.error.message}`));
    }
  }

  const existingForm = await client
    .from("materialForm")
    .select("id")
    .eq("id", SKUU_SPIKE_FORM_ID)
    .eq("companyId", ctx.companyId)
    .maybeSingle();
  if (!existingForm.data) {
    const ins = await upsertMaterialForm(client, {
      id: SKUU_SPIKE_FORM_ID,
      name: "Bulk",
      code: "BULK",
      companyId: ctx.companyId,
      createdBy: ctx.userId
    });
    if (ins.error && !ins.error.message.includes("duplicate")) {
      throw new Error(spikeAuthHint(`materialForm: ${ins.error.message}`));
    }
  }

  return {
    materialGeneratedIds,
    materialSubstanceId: SKUU_SPIKE_SUBSTANCE_ID,
    materialFormId: SKUU_SPIKE_FORM_ID
  };
}

/** When generated material IDs are on, upsertMaterial assigns a generated code — retarget to Cosmetri partCode. */
export async function retargetMaterialReadableId(
  ctx: SpikeContext,
  generatedReadableId: string,
  partCode: string
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
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await trx
      .updateTable("item")
      .set({
        readableId: partCode,
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
        materialSubstanceId: matRow.materialSubstanceId,
        materialFormId: matRow.materialFormId,
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