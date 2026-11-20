// SPDX-License-Identifier: AGPL-3.0-only

import { round } from "@carbon/database/precision";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carbon/database";
import { assignShipmentLineEntity } from "~/modules/inventory/inventory.server";
import {
  assignJobSerialNumbers,
  assignSerialNumbers,
  assignSerialNumbersPermission
} from "~/modules/production/production.service";
import { getTrackedEntityBins, invokePosting } from "~/modules/shared/shared.service";
import { handlesOf } from "../../test/database/fixtures/handles";
import type { SpikeContext } from "./context";
import { unwrap } from "./posting-helpers";

function sanitizeLotPrefix(part: string) {
  return part.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Carbon batch lot numbering via itemSerialSequence + assign-serial-numbers at job creation. */
export async function ensureItemBatchSequence(
  ctx: SpikeContext,
  itemId: string,
  lotPrefix: string
) {
  const prefix = `${sanitizeLotPrefix(lotPrefix)}-`;
  const existing = await ctx.db
    .selectFrom("itemSerialSequence")
    .select("id")
    .where("companyId", "=", ctx.companyId)
    .where("itemId", "=", itemId)
    .executeTakeFirst();
  if (existing) return;
  await ctx.db
    .insertInto("itemSerialSequence")
    .values({
      itemId,
      companyId: ctx.companyId,
      prefix,
      suffix: "",
      next: 1,
      size: 4,
      step: 1,
      createdBy: ctx.userId
    })
    .execute();
}

export async function stampJobBatchLotNumber(
  ctx: SpikeContext,
  jobId: string,
  itemId: string
) {
  const client = ctx.service.asSystem.supabase as SupabaseClient<Database>;
  const ok = await assignJobSerialNumbers(client, ctx.db, {
    jobId,
    itemId,
    companyId: ctx.companyId,
    userId: ctx.userId,
    at: "jobCreation"
  });
  if (!ok) {
    unwrap(
      await invokePosting(
        handlesOf(ctx),
        "assign-serial-numbers",
        { jobId, at: "jobCreation" },
        assignSerialNumbers,
        { as: assignSerialNumbersPermission }
      )
    );
  }
}

export async function assertLotShippableAtLocation(
  ctx: SpikeContext,
  trackedEntityId: string,
  locationId: string,
  quantity: number
) {
  const bins = await getTrackedEntityBins(ctx.db, {
    trackedEntityIds: [trackedEntityId],
    locationIds: [locationId],
    companyId: ctx.companyId
  });
  const bin = bins(trackedEntityId, locationId);
  if (!bin || round(bin.quantity) < round(quantity)) {
    throw new Error(
      `Lot ${trackedEntityId} has no shippable bin at location ${locationId} (need ${quantity}, have ${bin?.quantity ?? 0})`
    );
  }
}

export async function assignFillLotToShipmentLine(
  ctx: SpikeContext,
  args: {
    shipmentId: string;
    shipmentLineId: string;
    trackedEntityId: string;
    quantity: number;
  }
) {
  const lineLocation =
    (
      await ctx.db
        .selectFrom("shipmentLine")
        .select("locationId")
        .where("id", "=", args.shipmentLineId)
        .where("companyId", "=", ctx.companyId)
        .executeTakeFirst()
    )?.locationId ?? ctx.locationId;

  await assertLotShippableAtLocation(
    ctx,
    args.trackedEntityId,
    lineLocation,
    args.quantity
  );

  const result = await assignShipmentLineEntity(ctx.service, {
    trackingType: "batch",
    shipmentId: args.shipmentId,
    shipmentLineId: args.shipmentLineId,
    trackedEntityId: args.trackedEntityId,
    quantity: args.quantity
  });
  if (result.error) {
    throw new Error(
      `assignShipmentLineEntity: ${result.error.message ?? "failed"}`
    );
  }
}