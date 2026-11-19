#!/usr/bin/env node
/**
 * Smoke-test Enterprise stub shapes on the import chain that broke SSR dev.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { approvalDecisionValidator } = await import(
  pathToFileURL(path.join(root, "packages/ee/src/approvals.ts")).href
);
const { z } = await import("zod");
approvalDecisionValidator.extend({ id: z.string() }).parse({ id: "x" });
console.log("[ok] approvalDecisionValidator.extend");

const tsx = spawnSync(
  "pnpm",
  [
    "exec",
    "tsx",
    "--tsconfig",
    "tsconfig.json",
    "-e",
    `import './app/modules/carbon.server.ts'; console.log('[ok] carbon.server.ts');`,
  ],
  {
    cwd: path.join(root, "apps/erp"),
    env: {
      ...process.env,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "local-dev-stub-secret",
      CARBON_EDITION: "community",
    },
    encoding: "utf-8",
  }
);
if (tsx.status !== 0) {
  console.error(tsx.stderr || tsx.stdout);
  process.exit(tsx.status ?? 1);
}
process.stdout.write(tsx.stdout);