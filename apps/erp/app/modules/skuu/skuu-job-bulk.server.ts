// SPDX-License-Identifier: AGPL-3.0-only

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkuuBulkProfile } from "./skuu-bulk.service";

type Client = SupabaseClient<Database>;

async function resolveJobMakeMethodId(
  client: Client,
  jobId: string,
  companyId: string
): Promise<string | null> {
  const { data: jmm } = await client
    .from("jobMakeMethod")
    .select("makeMethodId")
    .eq("jobId", jobId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  return jmm?.makeMethodId ?? null;
}

async function resolveActiveMakeMethodForItem(
  client: Client,
  itemId: string,
  companyId: string
): Promise<string | null> {
  const { data: active } = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .eq("status", "Active")
    .maybeSingle();
  if (active?.id) return active.id;

  const { data: latest } = await client
    .from("makeMethod")
    .select("id")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest?.id ?? null;
}

/**
 * Make method for a job when Skuu bulk formula is enabled — uses jobMakeMethod
 * when present, else the item's active make method (reused spike jobs may lack jmm).
 */
export async function resolveSkuuBulkMakeMethodForJob(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<{ makeMethodId: string; itemId: string } | null> {
  const { data: job, error: jobErr } = await client
    .from("job")
    .select("id, itemId")
    .eq("id", args.jobId)
    .eq("companyId", args.companyId)
    .maybeSingle();
  if (jobErr || !job?.itemId) return null;

  let makeMethodId = await resolveJobMakeMethodId(
    client,
    args.jobId,
    args.companyId
  );
  if (!makeMethodId) {
    makeMethodId = await resolveActiveMakeMethodForItem(
      client,
      job.itemId,
      args.companyId
    );
  }
  if (!makeMethodId) return null;

  const profile = await loadSkuuBulkProfile(
    client,
    makeMethodId,
    args.companyId
  );
  if (!profile?.enabled) return null;

  return { makeMethodId, itemId: job.itemId };
}

export async function isSkuuBulkFormulaJob(
  client: Client,
  args: { jobId: string; companyId: string }
): Promise<boolean> {
  return (await resolveSkuuBulkMakeMethodForJob(client, args)) != null;
}

export async function findLatestSkuuBulkJobForItem(
  client: Client,
  itemId: string,
  companyId: string
): Promise<{ id: string; jobId: string | null } | null> {
  const { data: jobs } = await client
    .from("job")
    .select("id, jobId")
    .eq("itemId", itemId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: false })
    .limit(10);
  for (const row of jobs ?? []) {
    if (
      await isSkuuBulkFormulaJob(client, { jobId: row.id, companyId })
    ) {
      return { id: row.id, jobId: row.jobId };
    }
  }
  return null;
}