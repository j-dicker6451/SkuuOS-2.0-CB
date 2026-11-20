// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ServiceFn from "../../../../packages/api/src/service-fn.server.ts";

type ServiceContext = ServiceFn.ServiceContext;
const { createServiceContext } = ServiceFn;
import * as DbClient from "../../../../packages/database/src/client.ts";

const { getPostgresClient } = DbClient;
import { PostgresDriver, sql } from "kysely";
import { Pool, type PoolClient } from "pg";
import { spikeServiceRoleClient } from "./supabase-local";
import { resolveSpikeLookups, type SpikeLookups } from "./seed-lookups";
import { asSpikeDb, type SpikeDb } from "./spike-db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SpikeIngredient = {
  name: string;
  percentage: number;
  /** Real material part code; omitted values derive from the trade name slug. */
  partCode?: string;
  /** Optional phase number for % line (default 1). */
  phaseNumber?: number;
};

export type SpikeFormulaPhase = {
  phaseNumber: number;
  instructions?: string;
};

export type SpikeSecondProduct = {
  product: string;
  formulaRef: string;
  batchKg: number;
  expectedYieldPercent: number;
  ingredients: SpikeIngredient[];
};

export type SpikeInput = {
  product: string;
  formulaRef: string;
  version: string;
  batchKg: number;
  expectedYieldPercent: number;
  productDensityGPerMl: number;
  ingredients: SpikeIngredient[];
  /** FG fill jobs; empty array = bulk-only (no fill/ship trace assertions). */
  fills?: { packSizeMl: number; units: number }[];
  /** Optional finished batch volume (L) — informational; batchKg is the net kg basis. */
  batchTargetLiters?: number;
  /** Phase method text (optional; seeded into skuuFormulaPhase). */
  phases?: SpikeFormulaPhase[];
  /** Buy packaging parts per FG unit (optional; not in committed example). */
  packaging?: Array<{
    partCode: string;
    name: string;
    qtyPerUnit: number;
  }>;
  /** Synthetic second bulk formula reusing shared raw lots (committed fixture only). */
  secondProduct?: SpikeSecondProduct;
};

export function loadSpikeInput(): SpikeInput {
  const file =
    process.env.SKUU_PRODUCT_INPUT ??
    process.env.SKUU_SPIKE_INPUT ??
    path.join(__dirname, "example-formula.json");
  return JSON.parse(readFileSync(file, "utf8")) as SpikeInput;
}

export type SpikeContext = {
  db: SpikeDb;
  pool: Pool;
  companyId: string;
  groupId: string;
  userId: string;
  locationId: string;
  customerId: string;
  prefix: string;
  service: ServiceContext;
  lookups: SpikeLookups;
  cleanup?: () => Promise<void>;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export async function connectSpikeDb(): Promise<{
  db: SpikeDb;
  pool: Pool;
}> {
  const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || !LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
    throw new Error(
      "Set SUPABASE_DB_URL to a local Postgres URL (127.0.0.1 / localhost)."
    );
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    options: "-c app.sync_in_progress=true"
  });
  const db = asSpikeDb(getPostgresClient(pool, PostgresDriver));
  await sql`SELECT set_config('app.sync_in_progress', 'true', false)`.execute(db);
  return { db, pool };
}

async function withPgClient<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function resolveCompanyByEmail(
  client: PoolClient,
  email: string
): Promise<{ companyId: string; userId: string } | null> {
  const { rows } = await client.query<{
    companyId: string;
    userId: string;
  }>(
    `SELECT utc."companyId", utc."userId"
     FROM "userToCompany" utc
     JOIN "user" u ON u.id = utc."userId"
     WHERE u.email = $1 AND utc.role = 'employee'
     ORDER BY utc."companyId"
     LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

/** Seeded company (userToCompany), or an isolated always-post-style mini company. */
function spikeServiceContext(
  db: SpikeDb,
  companyId: string,
  groupId: string,
  userId: string
): ServiceContext {
  const client = spikeServiceRoleClient();
  if (!client) {
    throw new Error(
      "Local PostgREST required (pnpm dev / crbn up). Set PORT_API and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }
  return createServiceContext({
    actor: { type: "system", onBehalfOf: userId },
    company: { id: companyId, groupId },
    caller: client,
    system: () => client,
    pg: () => db,
    kv: () => unavailable("kv")
  });
}

export async function buildSpikeContext(
  input: SpikeInput,
  tag: string
): Promise<SpikeContext> {
  const { db, pool } = await connectSpikeDb();
  const email = process.env.SKUU_SPIKE_USER ?? "test@carbon.ms";

  const resolved = await withPgClient(pool, (client) =>
    resolveCompanyByEmail(client, email)
  );
  if (resolved) {
      const company = await db
        .selectFrom("company")
        .select(["id", "companyGroupId", "baseCurrencyCode"])
        .where("id", "=", resolved.companyId)
        .executeTakeFirstOrThrow();
      const location = await db
        .selectFrom("location")
        .select("id")
        .where("companyId", "=", company.id)
        .orderBy("id")
        .limit(1)
        .executeTakeFirst();
      if (!location) {
        throw new Error(
          `No location for company ${company.id} — run db seed first.`
        );
      }
      const customer = await db
        .selectFrom("customer")
        .select("id")
        .where("companyId", "=", company.id)
        .orderBy("id")
        .limit(1)
        .executeTakeFirst();
      if (!customer) {
        throw new Error(`No customer for company ${company.id}`);
      }
      const prefix = `${tag}-${input.formulaRef}`.replace(/[^a-zA-Z0-9-_]/g, "-");
      const lookups = await resolveSpikeLookups(
        db,
        company.id,
        company.companyGroupId!,
        company.baseCurrencyCode
      );
      const service = spikeServiceContext(
        db,
        company.id,
        company.companyGroupId!,
        resolved.userId
      );
    return {
      db,
      pool,
      companyId: company.id,
      groupId: company.companyGroupId!,
      userId: resolved.userId,
      locationId: location.id,
      customerId: customer.id,
      prefix,
      service,
      lookups
    };
  }

  throw new Error(
    `No company for ${email}. Run db seed (pnpm db:seed:dev -- --email ${email}) first.`
  );
}

function unavailable(name: string): never {
  return new Proxy({} as never, {
    get() {
      throw new Error(`Spike harness does not use ${name}`);
    }
  });
}