#!/usr/bin/env node
/**
 * SkuuOS formula → bulk → fill → dispatch spike harness.
 *
 * Usage (local dev DB):
 *   pnpm skuu:spike
 *
 * Optional reset label prefix:
 *   SKUU_SPIKE_PREFIX=demo-001 pnpm skuu:spike
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
function validatePercentSum(lines, tolerance = 0.05) {
  const total = lines.reduce((s, l) => s + (l.percentWw ?? 0), 0);
  return Math.abs(100 - total) <= tolerance
    ? { ok: true, total }
    : { ok: false, total, message: `Total ${total}%` };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadInput() {
  const file =
    process.env.SKUU_SPIKE_INPUT ??
    path.join(__dirname, "example-formula.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

const report = [];

function note(section, message) {
  report.push({ section, message });
  process.stdout.write(`[${section}] ${message}\n`);
}

async function main() {
  const input = loadInput();
  const prefix = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
  const dbUrl =
    process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
  if (!dbUrl) {
    note("env", "SUPABASE_DB_URL or DATABASE_URL required");
    process.exit(1);
  }

  const percentCheck = validatePercentSum(
    input.ingredients.map((i, idx) => ({
      id: String(idx),
      percentWw: i.percentage
    }))
  );
  note(
    "formula",
    percentCheck.ok
      ? `Ingredient % total OK (${percentCheck.total})`
      : `Ingredient % FAILED: ${percentCheck.message}`
  );

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const schema = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'itemPlanning'
      AND column_name IN ('minimumOrderQuantity','orderMultiple')
  `);
  note(
    "schema",
    schema.rows.length
      ? `itemPlanning MOQ columns: ${schema.rows
          .map((r) => `${r.column_name}=${r.data_type}`)
          .join(", ")}`
      : "itemPlanning MOQ columns not found (migrations not applied?)"
  );

  const skuuTables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'skuu%'
    ORDER BY 1
  `);
  note(
    "schema",
    skuuTables.rows.length
      ? `Skuu tables: ${skuuTables.rows.map((r) => r.table_name).join(", ")}`
      : "No skuu_* tables — run migrations 20261119120100 + 20261119120000"
  );

  const company = await client.query(
    `SELECT c.id, c.name FROM "company" c
     INNER JOIN "employee" e ON e."companyId" = c.id
     INNER JOIN "user" u ON u.id = e."userId"
     WHERE u.email = $1 LIMIT 1`,
    [process.env.SKUU_SPIKE_USER ?? "test@carbon.ms"]
  );
  if (!company.rows[0]) {
    note(
      "seed",
      "No company for test user — seed satellite dataset first (pnpm dev / db seed)"
    );
  } else {
    note("seed", `Company ${company.rows[0].name} (${company.rows[0].id})`);
  }

  note(
    "spike",
    `Planned batch ${input.batchKg} kg for ${input.product} (${input.formulaRef} v${input.version})`
  );
  note(
    "spike",
    `Fill sizes: ${input.fills.map((f) => `${f.units}×${f.packSizeMl}mL`).join(", ")}`
  );
  note(
    "friction",
    "Full automated posting (receipt → bulk job → complete → pull fill → SO → ship) is not wired in this harness yet; it validates schema, formula math, and prints trace queries to run after manual/Ops steps."
  );
  note(
    "trace",
    "Forward trace SQL template: walk trackedActivity outputEntityId from raw lots → bulk lot → fill lots (run after jobs complete)."
  );
  note(
    "friction",
    "One bulk lot split across several fill jobs: Pull-from-Inventory lines can reference the same trackedEntityId; verify remaining quantity after each issue — Carbon may require partial picks to match available qty."
  );

  const tag = `${prefix}-${input.formulaRef}`;
  note("reset", `Idempotent tag for created readable IDs: ${tag}`);

  await client.end();

  const reportPath = path.join(__dirname, "report-last-run.txt");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    reportPath,
    report.map((r) => `${r.section}: ${r.message}`).join("\n") + "\n",
    "utf8"
  );
  note("done", `Report written to ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});