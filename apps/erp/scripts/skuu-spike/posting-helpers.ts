// SPDX-License-Identifier: AGPL-3.0-only

import type { KyselyDatabase } from "@carbon/database/client";
import type { Transaction } from "kysely";
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
  db: import("kysely").Kysely<KyselyDatabase>,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<unknown>
) {
  await db.transaction().execute(async (trx) => {
    await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);
    await fn(trx);
  });
}