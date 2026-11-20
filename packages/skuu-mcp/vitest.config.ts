// SPDX-License-Identifier: AGPL-3.0-only

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const rootEnv = loadEnv("development", repoRoot, "");
for (const [key, value] of Object.entries(rootEnv)) {
  if (process.env[key] === undefined && value !== undefined) {
    process.env[key] = value;
  }
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true
  }
});