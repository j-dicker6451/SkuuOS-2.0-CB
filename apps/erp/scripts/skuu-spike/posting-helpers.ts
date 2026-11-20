// SPDX-License-Identifier: AGPL-3.0-only

import type { SpikeDb, SpikeTrx } from "./spike-db";
import { sql } from "kysely";

export function unwrap<T>(result: {
  data: T | null;
  error: { message?: string } | null;
}): T {
  if (result.error) {
    throw new Error(result.error.message ?? "Posting failed");
  }
  if (result.data == null) throw new Error("Posting returned no data");
  return result.data;
}

export async function seedTrx(
  db: SpikeDb,
  fn: (trx: SpikeTrx) => Promise<unknown>
) {
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await fn(trx);
  });
}