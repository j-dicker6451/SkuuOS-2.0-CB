// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import {
  createReadonlyPool,
  withReadOnlyTransaction
} from "../src/db";

const dbUrl =
  process.env.SKUUOS_MCP_DATABASE_URL ?? process.env.SUPABASE_DB_URL;

describe.skipIf(!dbUrl)("read-only database guard", () => {
  it("rejects writes inside withReadOnlyTransaction", async () => {
    const pool = createReadonlyPool(dbUrl!);
    await expect(
      withReadOnlyTransaction(pool, async (db) => {
        await sql`INSERT INTO "tag" ("name", "table", "companyId", "createdBy")
          VALUES ('mcp-probe', 'item', 'probe-co', 'probe-user')`.execute(db);
      })
    ).rejects.toThrow();
    await pool.end();
  });
});