// SPDX-License-Identifier: AGPL-3.0-only

import {
  getPostgresClient,
  type KyselyDatabase
} from "@carbon/database/client";
import { type Kysely, PostgresDriver, sql } from "kysely";
import { Pool } from "pg";

export type ReadonlyDb = Kysely<KyselyDatabase>;

const ENV_DATABASE_URL = "SKUUOS_MCP_DATABASE_URL";

export function resolveReadonlyDatabaseUrl(): string {
  const url = process.env[ENV_DATABASE_URL];
  if (!url) {
    throw new Error(
      `${ENV_DATABASE_URL} is required (read-only Postgres role; see docs/skuu-mcp.md)`
    );
  }
  return url;
}

export function createReadonlyPool(connectionString?: string): Pool {
  return new Pool({
    connectionString: connectionString ?? resolveReadonlyDatabaseUrl(),
    max: 6,
    application_name: "skuuos-mcp-readonly"
  });
}

export function createReadonlyDb(pool: Pool): ReadonlyDb {
  return getPostgresClient(pool, PostgresDriver);
}

/** Every query runs in a READ ONLY transaction (defense in depth with DB role). */
export async function withReadOnlyTransaction<T>(
  pool: Pool,
  fn: (db: ReadonlyDb) => Promise<T>
): Promise<T> {
  const db = createReadonlyDb(pool);
  return db.transaction().execute(async (trx) => {
    await sql`SET TRANSACTION READ ONLY`.execute(trx);
    return fn(trx as ReadonlyDb);
  });
}

export type CompanyScoped = { companyId: string };
