// SPDX-License-Identifier: AGPL-3.0-only

import { validator } from "@carbon/form";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  completeSkuuJobPhase,
  markSkuuDispenseAdded,
  upsertSkuuDispenseRow
} from "~/modules/skuu/skuu-batch-record.service";
import {
  skuuBatchRecordCompleteValidator,
  skuuDispenseMarkValidator,
  skuuDispenseRowValidator
} from "~/modules/skuu/skuu.models";

export async function action(args: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(args.request, {
    update: "production"
  });
  const formData = await args.request.formData();

  if (formData.get("dispenseId")) {
    const input = await validator(skuuDispenseMarkValidator).request(args);
    if ("invalid" in input) return input.invalid;
    await markSkuuDispenseAdded(client, {
      companyId,
      userId,
      dispenseId: input.data.dispenseId,
      markedAdded: input.data.markedAdded === true,
      correctionReason: input.data.correctionReason ?? null
    });
    return { ok: true };
  }

  if (formData.get("jobMaterialId")) {
    const input = await validator(skuuDispenseRowValidator).request(args);
    if ("invalid" in input) return input.invalid;
    await upsertSkuuDispenseRow(client, {
      companyId,
      userId,
      jobMaterialId: input.data.jobMaterialId,
      quantityKg: input.data.quantityKg,
      supplierBatchNumber: input.data.supplierBatchNumber
    });
    return { ok: true };
  }

  const input = await validator(skuuBatchRecordCompleteValidator).request(args);
  if ("invalid" in input) return input.invalid;
  await completeSkuuJobPhase(client, {
    jobId: input.data.jobId,
    companyId,
    userId,
    phaseNumber: input.data.phaseNumber,
    notes: input.data.notes,
    correctionReason: input.data.correctionReason
  });
  return { ok: true };
}