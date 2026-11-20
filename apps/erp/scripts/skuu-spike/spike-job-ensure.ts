// SPDX-License-Identifier: AGPL-3.0-only

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carbon/database";
import { insertJob } from "~/modules/production/production.service";
import type { SpikeContext } from "./context";

type JobInsert = Parameters<typeof insertJob>[2];

export type SpikeJobEnsureResult = {
  primaryId: string;
  humanJobId: string;
  reused: boolean;
};

async function findSpikeJobByHumanId(
  ctx: SpikeContext,
  humanJobId: string
): Promise<{ id: string; jobId: string } | undefined> {
  return ctx.db
    .selectFrom("job")
    .select(["id", "jobId"])
    .where("companyId", "=", ctx.companyId)
    .where("jobId", "=", humanJobId)
    .executeTakeFirst();
}

/** @internal test helper — attempt 0 = base, 1 = `-0002`, … */
export function spikeJobHumanIdForAttempt(
  baseHumanId: string,
  attempt: number
): string {
  return attempt === 0
    ? baseHumanId
    : `${baseHumanId}-${String(attempt + 1).padStart(4, "0")}`;
}

function isDuplicateJobIdError(message: string | undefined): boolean {
  return (
    message?.includes("duplicate key") === true ||
    message?.includes("job_jobId_key") === true
  );
}

/**
 * Reuse an existing spike/job when `job.jobId` (human number) already exists;
 * otherwise insert, or on collision allocate `{base}-0002`, `{base}-0003`, …
 */
export async function ensureSpikeJobCreated(
  ctx: SpikeContext,
  client: SupabaseClient<Database>,
  humanJobIdBase: string,
  input: JobInsert
): Promise<SpikeJobEnsureResult> {
  const existing = await findSpikeJobByHumanId(ctx, humanJobIdBase);
  if (existing) {
    return {
      primaryId: existing.id,
      humanJobId: existing.jobId,
      reused: true
    };
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const humanJobId = spikeJobHumanIdForAttempt(humanJobIdBase, attempt);

    const taken = await findSpikeJobByHumanId(ctx, humanJobId);
    if (taken) {
      return {
        primaryId: taken.id,
        humanJobId: taken.jobId,
        reused: true
      };
    }

    const created = await insertJob(client, ctx.db, {
      ...input,
      jobId: humanJobId
    });
    if (!created.error && created.data) {
      return {
        primaryId: created.data.id,
        humanJobId,
        reused: false
      };
    }

    if (isDuplicateJobIdError(created.error?.message)) {
      const raced = await findSpikeJobByHumanId(ctx, humanJobId);
      if (raced) {
        return {
          primaryId: raced.id,
          humanJobId: raced.jobId,
          reused: true
        };
      }
      continue;
    }

    throw new Error(
      `insertJob failed: ${created.error?.message ?? "unknown"}`
    );
  }

  throw new Error(`insertJob failed: could not allocate job id for ${humanJobIdBase}`);
}