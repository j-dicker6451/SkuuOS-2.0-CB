// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SkuuFillBulkPullOverlay } from "./skuu-job-fill-display";

type Client = SupabaseClient<Database>;

const FG_PACK_ML_RE = /-(\d+)ML$/i;

export async function loadSkuuFillBulkPullOverlay(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<SkuuFillBulkPullOverlay | null> {
  const { data: job } = await client
    .from("job")
    .select("id, quantity, itemId, item(readableIdWithRevision)")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (!job?.itemId) return null;

  const fgReadable = job.item?.readableIdWithRevision ?? "";
  const packMatch = fgReadable.match(FG_PACK_ML_RE);
  if (!packMatch) return null;

  const packSizeMl = Number(packMatch[1]);
  if (!(packSizeMl > 0)) return null;

  const { data: pull } = await client
    .from("jobMaterial")
    .select("itemId, quantity, estimatedQuantity")
    .eq("jobId", args.jobId)
    .eq("companyId", args.companyId)
    .eq("methodType", "Pull from Inventory")
    .limit(1)
    .maybeSingle();
  if (!pull?.itemId) return null;

  const units = Number(job.quantity);
  const lineKg = Number(pull.estimatedQuantity ?? pull.quantity ?? 0);
  if (!(lineKg > 0) || !(units > 0)) return null;

  // Exploded fill BOM stores total bulk kg on the line, not per finished unit.
  const kgPerUnit = Math.round((lineKg / units) * 1000) / 1000;
  const totalKg = Math.round(lineKg * 1000) / 1000;

  return {
    bulkItemId: pull.itemId,
    packSizeMl,
    kgPerUnit,
    totalKg
  };
}