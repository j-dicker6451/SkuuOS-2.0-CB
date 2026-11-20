// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import vitestConfig from "./vitest.config.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const spikeMode = process.env.MODE ?? process.env.NODE_ENV ?? "development";
const rootEnv = loadEnv(spikeMode, repoRoot, "");
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === undefined && value !== undefined) {
    process.env[key] = value;
  }
}

const spikeEnvKeys = [
  "SUPABASE_DB_URL",
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_API_URL",
  "SESSION_SECRET",
  "REDIS_URL"
] as const;

function envOrRoot(key: (typeof spikeEnvKeys)[number]): string | undefined {
  return process.env[key] ?? rootEnv[key];
}

export default {
  ...vitestConfig,
  test: {
    ...vitestConfig.test,
    // Spike is not in the app/** test glob; run it in its own project.
    projects: undefined,
    include: ["scripts/skuu-spike/**/*.test.ts"],
    passWithNoTests: false,
    // Load repo-root `.env` then `.env.local` (via loadEnv) so a fresh shell
    // can run `pnpm skuu:spike` without manually exporting secrets.
    env: {
      ...vitestConfig.test?.env,
      SUPABASE_DB_URL: envOrRoot("SUPABASE_DB_URL") ?? envOrRoot("DATABASE_URL"),
      SUPABASE_URL: envOrRoot("SUPABASE_URL"),
      SUPABASE_ANON_KEY: envOrRoot("SUPABASE_ANON_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: envOrRoot("SUPABASE_SERVICE_ROLE_KEY"),
      SUPABASE_API_URL: envOrRoot("SUPABASE_API_URL"),
      SESSION_SECRET: envOrRoot("SESSION_SECRET"),
      REDIS_URL: envOrRoot("REDIS_URL")
    }
  }
};