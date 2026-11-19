#!/usr/bin/env node
/**
 * Import built SSR bundles without Docker to catch module-evaluation TypeErrors.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

process.env.SESSION_SECRET ??= "local-dev-stub-secret-0123456789abcdef";
process.env.DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.SUPABASE_DB_URL ??= process.env.DATABASE_URL;
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_ANON_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdHViIn0.stub";
process.env.SUPABASE_SERVICE_ROLE_KEY ??=
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdHViIn0.stub";
process.env.SKIP_ENV_VALIDATION ??= "1";
process.env.CARBON_EDITION ??= "community";
process.env.NODE_ENV ??= "production";
process.env.ERP_URL ??= "http://localhost:3000";
process.env.MES_URL ??= "http://localhost:3001";
process.env.API_URL ??= "http://localhost:54321";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.INNGEST_SIGNING_KEY ??= "signkey-local-stub-0000000000000000";
process.env.INNGEST_EVENT_KEY ??= "local-stub-inngest-event-key";
process.env.SMTP_FROM ??= "Carbon <no-reply@example.test>";

async function importBuiltEeChunk() {
  const assets = path.join(root, "apps/erp/build/server/assets");
  const { readdirSync } = await import("node:fs");
  const ee = readdirSync(assets).find((f) => f.startsWith("carbon-ee-"));
  if (!ee) throw new Error("carbon-ee chunk missing (run pnpm build:erp first)");
  await import(pathToFileURL(path.join(assets, ee)).href);
  console.log(`[ok] ERP server bundle includes ${ee}`);
}

async function importFullServer(app) {
  const build = path.join(root, `apps/${app}/build/server/index.js`);
  await import(pathToFileURL(build).href);
  console.log(`[ok] ${app} server build imported`);
}

let failed = false;
try {
  await importBuiltEeChunk();
} catch (error) {
  failed = true;
  console.error("[fail] carbon-ee chunk:", error);
}

for (const app of ["erp", "mes"]) {
  try {
    await importFullServer(app);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      console.warn(`[skip] ${app} build not present`);
      continue;
    }
    const msg = String(error?.message ?? error);
    if (error instanceof TypeError) {
      failed = true;
      console.error(`[fail] ${app} server build TypeError:`, error);
      continue;
    }
    console.warn(
      `[warn] ${app} server build import stopped after bundle load (${msg.split("\n")[0]})`
    );
  }
}

if (failed) process.exit(1);