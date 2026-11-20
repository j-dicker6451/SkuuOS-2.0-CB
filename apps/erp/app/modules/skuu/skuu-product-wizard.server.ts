// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import { getDatabaseClient } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertMaterial, upsertPart } from "~/modules/items/items.service";
import { getMakeMethodsOnce } from "~/modules/items/items.service";
import {
  upsertSkuuBulkProfile,
  upsertSkuuMaterialPercent
} from "./skuu-bulk.service";
import { upsertSkuuFormulaPhase } from "./skuu-formulation.service";
import type { SkuuProductWizardDraft } from "./skuu-product-wizard.models";
import { wizardFormulaCheck } from "./skuu-product-wizard.models";

type Client = SupabaseClient<Database>;

export async function searchWizardMaterials(
  client: Client,
  companyId: string,
  query: string
) {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q}%`;
  const { data } = await client
    .from("item")
    .select("id, readableId, name, type")
    .eq("companyId", companyId)
    .eq("type", "Material")
    .or(`readableId.ilike.${pattern},name.ilike.${pattern}`)
    .limit(25);
  return data ?? [];
}

export async function resolveMaterialSubstanceShape(
  _client: Client,
  _companyId: string,
  _userId: string
) {
  return {};
}

async function ensureWizardMaterial(
  client: Client,
  companyId: string,
  userId: string,
  partCode: string,
  tradeName: string
): Promise<string> {
  const { data: existing } = await client
    .from("item")
    .select("id, name")
    .eq("companyId", companyId)
    .eq("readableId", partCode)
    .eq("type", "Material")
    .maybeSingle();
  if (existing) {
    if (existing.name !== tradeName) {
      await client
        .from("item")
        .update({ name: tradeName, updatedBy: userId, updatedAt: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  const shape = await resolveMaterialSubstanceShape(client, companyId, userId);
  const created = await upsertMaterial(client, getDatabaseClient(), {
    id: partCode,
    name: tradeName,
    replenishmentSystem: "Buy",
    defaultMethodType: "Purchase to Order",
    itemTrackingType: "Batch",
    unitOfMeasureCode: "kg",
    unitCost: 1,
    companyId,
    createdBy: userId,
    ...shape
  });
  if (created.error) {
    throw new Error(created.error.message);
  }
  const { data: row } = await client
    .from("item")
    .select("id")
    .eq("companyId", companyId)
    .eq("readableId", partCode)
    .single();
  if (!row) throw new Error(`Material ${partCode} missing after create`);
  return row.id;
}

async function resolveActiveMakeMethodId(
  client: Client,
  itemId: string,
  companyId: string
) {
  const methods = await getMakeMethodsOnce(client, itemId, companyId);
  const active =
    methods.data?.find((m) => m.status === "Active") ?? methods.data?.[0];
  if (!active?.id) {
    throw new Error("No make method on bulk part");
  }
  return active.id;
}

export type CreateSkuuProductResult = {
  bulkItemId: string;
  bulkReadableId: string;
  fillItemIds: Array<{ itemId: string; readableId: string; packSizeMl: number }>;
};

export async function createSkuuProductFromWizard(
  client: Client,
  companyId: string,
  userId: string,
  draft: SkuuProductWizardDraft
): Promise<CreateSkuuProductResult> {
  const check = wizardFormulaCheck(draft);
  if (!check.ok) {
    throw new Error(check.message ?? "Formula must total 100%");
  }

  const formulaRef = draft.formulaRef.replace(/[^a-zA-Z0-9-_]/g, "-");
  const bulkReadableId = `BULK-${formulaRef}`;

  await upsertPart(client, {
    id: bulkReadableId,
    name: draft.productName,
    revision: "0",
    replenishmentSystem: "Make",
    defaultMethodType: "Make to Order",
    itemTrackingType: "Batch",
    unitOfMeasureCode: "kg",
    shelfLifeCalculateFromBom: false,
    companyId,
    createdBy: userId
  });

  const { data: bulkItem } = await client
    .from("item")
    .select("id")
    .eq("companyId", companyId)
    .eq("readableId", bulkReadableId)
    .single();

  const makeMethodId = await resolveActiveMakeMethodId(
    client,
    bulkItem.id,
    companyId
  );

  const processName = `${draft.productName} mix`;
  const sharedProcessId = `skuu-process-${formulaRef}-mix`;
  let processId = sharedProcessId;
  const { data: existingProcess } = await client
    .from("process")
    .select("id")
    .eq("companyId", companyId)
    .eq("name", processName)
    .maybeSingle();
  if (existingProcess) {
    processId = existingProcess.id;
  } else {
    await client.from("process").insert({
      id: processId,
      name: processName,
      defaultStandardFactor: "Hours/Piece",
      companyId,
      createdBy: userId
    });
  }

  let operationId = `skuu-wizard-op-${formulaRef}`;
  const { data: existingOp } = await client
    .from("methodOperation")
    .select("id")
    .eq("makeMethodId", makeMethodId)
    .eq("processId", processId)
    .eq("description", "Blend")
    .maybeSingle();
  if (existingOp) {
    operationId = existingOp.id;
  } else {
    await client.from("methodOperation").insert({
      id: operationId,
      makeMethodId,
      processId,
      description: "Blend",
      companyId,
      createdBy: userId
    });
  }

  for (let i = 0; i < draft.ingredients.length; i++) {
    const line = draft.ingredients[i]!;
    const itemId = await ensureWizardMaterial(
      client,
      companyId,
      userId,
      line.partCode,
      line.tradeName
    );
    const mmId = `skuu-wizard-mm-${formulaRef}-${line.partCode}`;
    const { data: existingMm } = await client
      .from("methodMaterial")
      .select("id")
      .eq("makeMethodId", makeMethodId)
      .eq("itemId", itemId)
      .maybeSingle();
    const methodMaterialId = existingMm?.id ?? mmId;
    if (!existingMm) {
      await client.from("methodMaterial").insert({
        id: methodMaterialId,
        makeMethodId,
        methodOperationId: operationId,
        itemId,
        itemType: "Material",
        methodType: "Pull from Inventory",
        quantity: 0,
        unitOfMeasureCode: "kg",
        companyId,
        createdBy: userId
      });
    }
    await upsertSkuuMaterialPercent(client, {
      methodMaterialId,
      companyId,
      userId,
      percentWw: line.percentWw,
      phaseNumber: line.phaseNumber
    });
  }

  const { SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER } = await import(
    "./skuu-phased-formula"
  );
  const phaseRows =
    draft.phases.length > 0
      ? draft.phases
      : [{ phaseNumber: 1, instructions: SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER }];
  for (const phase of phaseRows) {
    await upsertSkuuFormulaPhase(client, {
      makeMethodId,
      companyId,
      userId,
      phaseNumber: phase.phaseNumber,
      instructions: phase.instructions
    });
  }

  await upsertSkuuBulkProfile(client, {
    makeMethodId,
    companyId,
    userId,
    profile: {
      enabled: true,
      batchBasisKg: draft.standardBatchKg,
      yieldLossPercent: 0,
      productDensityGPerMl: draft.productDensityGPerMl,
      expectedYieldPercent: draft.expectedYieldPercent
    }
  });

  const fillItems: CreateSkuuProductResult["fillItemIds"] = [];
  const density = draft.productDensityGPerMl ?? 1;

  for (const fill of draft.fills) {
    const fgId = `FG-${formulaRef}-${fill.packSizeMl}ML`;
    await upsertPart(client, {
      id: fgId,
      name: `${draft.productName} ${fill.packSizeMl} mL`,
      revision: "0",
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order",
      itemTrackingType: "Batch",
      unitOfMeasureCode: "EA",
      shelfLifeCalculateFromBom: false,
      companyId,
      createdBy: userId
    });
    const { data: fgItem } = await client
      .from("item")
      .select("id")
      .eq("readableId", fgId)
      .eq("companyId", companyId)
      .single();
    fillItems.push({
      itemId: fgItem.id,
      readableId: fgId,
      packSizeMl: fill.packSizeMl
    });

    const fgMethodId = await resolveActiveMakeMethodId(
      client,
      fgItem.id,
      companyId
    );
    const kgPerUnit = (fill.packSizeMl * density) / 1000;
    const fillProcessName = `Fill ${fill.packSizeMl}mL`;
    let fillProcessId = `skuu-process-fill-${formulaRef}-${fill.packSizeMl}ml`;
    const { data: fp } = await client
      .from("process")
      .select("id")
      .eq("companyId", companyId)
      .eq("name", fillProcessName)
      .maybeSingle();
    if (fp) fillProcessId = fp.id;
    else {
      await client.from("process").insert({
        id: fillProcessId,
        name: fillProcessName,
        defaultStandardFactor: "Hours/Piece",
        companyId,
        createdBy: userId
      });
    }
    const fopId = `skuu-wizard-fop-${formulaRef}-${fill.packSizeMl}`;
    const { data: existingFop } = await client
      .from("methodOperation")
      .select("id")
      .eq("makeMethodId", fgMethodId)
      .eq("processId", fillProcessId)
      .maybeSingle();
    const fillOpId = existingFop?.id ?? fopId;
    if (!existingFop) {
      await client.from("methodOperation").insert({
        id: fillOpId,
        makeMethodId: fgMethodId,
        processId: fillProcessId,
        description: "Fill",
        companyId,
        createdBy: userId
      });
    }
    const fmatId = `skuu-wizard-fmat-${formulaRef}-${fill.packSizeMl}`;
    const { data: existingFmat } = await client
      .from("methodMaterial")
      .select("id")
      .eq("makeMethodId", fgMethodId)
      .eq("itemId", bulkItem.id)
      .maybeSingle();
    if (!existingFmat) {
      await client
        .from("methodMaterial")
        .insert({
          id: fmatId,
          makeMethodId: fgMethodId,
          methodOperationId: fillOpId,
          itemId: bulkItem.id,
          itemType: "Part",
          methodType: "Pull from Inventory",
          quantity: kgPerUnit,
          unitOfMeasureCode: "kg",
          companyId,
          createdBy: userId
        });
    } else {
      await client
        .from("methodMaterial")
        .update({ quantity: kgPerUnit, methodOperationId: fillOpId })
        .eq("id", existingFmat.id);
    }
  }

  return {
    bulkItemId: bulkItem.id,
    bulkReadableId,
    fillItemIds: fillItems
  };
}