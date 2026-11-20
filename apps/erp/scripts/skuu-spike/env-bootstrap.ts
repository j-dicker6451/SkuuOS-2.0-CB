// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../.."
);

function loadDotEnv(): void {
  for (const file of [".env", ".env.local"]) {
    const full = path.join(REPO_ROOT, file);
    if (!existsSync(full)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(full, "utf8"))
    )) {
      if (file === ".env.local" || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

/** Match app startup: repo root `.env`, then `.env.local` overrides. */
export function bootstrapSpikeEnv(): string {
  if (process.cwd() !== REPO_ROOT) {
    process.chdir(REPO_ROOT);
  }
  loadDotEnv();
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.CARBON_EDITION ??= "community";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  return REPO_ROOT;
}