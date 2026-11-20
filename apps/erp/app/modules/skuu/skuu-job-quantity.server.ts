// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import { formatSkuuGrossBatchLabel, grossInputKg } from "@skuu/formula";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBulkBatchTicket } from "./skuu-batch-ticket.server";

type Client = SupabaseClient<Database>;

export type SkuuJobQuantitySummary = {
  targetFinishedKg: number;
  grossKg: number;
  grossLiters: number | null;
  expectedYieldPercent: number;
  densityGPerMl: number | null;
  headerLabel: string;
  netFinishedLiters: number | null;
};

export async function loadSkuuJobQuantitySummary(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<SkuuJobQuantitySummary | null> {
  const ticket = await buildBulkBatchTicket(client, args);
  if (!ticket) return null;

  const grossKg = grossInputKg(
    ticket.targetFinishedKg,
    ticket.expectedYieldPercent
  );
  const density = ticket.densityGPerMl;
  const netFinishedLiters =
    density && density > 0 ? ticket.targetFinishedKg / density : null;

  return {
    targetFinishedKg: ticket.targetFinishedKg,
    grossKg,
    grossLiters: ticket.batchSizeL,
    expectedYieldPercent: ticket.expectedYieldPercent,
    densityGPerMl: density,
    netFinishedLiters,
    headerLabel: formatSkuuGrossBatchLabel({
      targetFinishedKg: ticket.targetFinishedKg,
      expectedYieldPercent: ticket.expectedYieldPercent,
      productDensityGPerMl: density
    })
  };
}