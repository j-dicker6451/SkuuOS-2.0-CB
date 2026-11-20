// SPDX-License-Identifier: AGPL-3.0-only

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";

/** Master-data codes resolved from the seeded company (satellite / Carbon Development). */
export type SpikeLookups = {
  unitKg: string;
  unitEa: string;
  currencyCode: string;
  /** `process.defaultStandardFactor` — valid enum in Carbon. */
  standardFactor: "Hours/Piece";
};

async function pickUnitCode(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  label: string,
  candidates: string[]
): Promise<string> {
  const matches = await db
    .selectFrom("unitOfMeasure")
    .select("code")
    .where("companyId", "=", companyId)
    .where("code", "in", candidates)
    .execute();
  const hit = new Set(matches.map((r) => r.code));
  for (const code of candidates) {
    if (hit.has(code)) return code;
  }
  const active = await db
    .selectFrom("unitOfMeasure")
    .select("code")
    .where("companyId", "=", companyId)
    .where("active", "=", true)
    .orderBy("code")
    .execute();
  throw new Error(
    `Spike: no ${label} unit of measure (tried ${candidates.join(", ")}). ` +
      `Active company codes: ${active.map((r) => r.code).join(", ") || "(none)"}`
  );
}

async function resolveCurrencyCode(
  db: Kysely<KyselyDatabase>,
  companyGroupId: string,
  baseCurrencyCode: string | null
): Promise<string> {
  const code = baseCurrencyCode?.trim() || "USD";
  const row = await db
    .selectFrom("currency")
    .select("code")
    .where("companyGroupId", "=", companyGroupId)
    .where("code", "=", code)
    .executeTakeFirst();
  if (row) return row.code;
  const groupCurrencies = await db
    .selectFrom("currency")
    .select("code")
    .where("companyGroupId", "=", companyGroupId)
    .orderBy("code")
    .execute();
  throw new Error(
    `Spike: currency ${code} missing for company group. ` +
      `Available: ${groupCurrencies.map((r) => r.code).join(", ") || "(none)"}`
  );
}

/**
 * Load UoM and currency codes from the DB so inserts match seeded master data
 * (metric companies use `kg`, not `KG`; count units use `EA`).
 */
export async function resolveSpikeLookups(
  db: Kysely<KyselyDatabase>,
  companyId: string,
  companyGroupId: string,
  baseCurrencyCode: string | null
): Promise<SpikeLookups> {
  const [unitKg, unitEa, currencyCode] = await Promise.all([
    pickUnitCode(db, companyId, "mass (kg)", ["kg", "KG", "Kg"]),
    pickUnitCode(db, companyId, "count (each)", ["EA", "ea", "Ea"]),
    resolveCurrencyCode(db, companyGroupId, baseCurrencyCode)
  ]);
  return {
    unitKg,
    unitEa,
    currencyCode,
    standardFactor: "Hours/Piece"
  };
}