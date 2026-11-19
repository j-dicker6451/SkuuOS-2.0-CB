#!/usr/bin/env node
/**
 * Client-side plan gate smoke test (loader returns string | null, not {}).
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tmp = path.join(root, "scripts", ".verify-plan-gate.tmp.ts");

writeFileSync(
  tmp,
  `
import { normalizePlanId } from "@carbon/utils";
import {
  planMeetsRequirement,
  resolveRequirement
} from "../packages/ee/src/plan.ts";

for (const raw of [null, undefined, "STARTER", "PARTNER-400"]) {
  const plan = normalizePlanId(raw);
  planMeetsRequirement(plan, resolveRequirement({ feature: "WORKFLOWS" }));
  if (typeof plan !== "string") throw new TypeError("plan enum");
}
try {
  normalizePlanId({} as never);
  throw new Error("expected throw");
} catch (e) {
  if (!(e instanceof TypeError)) throw e;
}
const plan = normalizePlanId(null);
const req = resolveRequirement({ feature: "API_KEYS" });
const isGated = true || !planMeetsRequirement(plan, req);
console.log("[ok] normalizePlanId + client usePlanGate path", { plan, isGated });
`,
  "utf-8"
);

const run = spawnSync(
  "pnpm",
  ["exec", "tsx", tmp],
  {
    cwd: root,
    env: { ...process.env, CARBON_EDITION: "community" },
    encoding: "utf-8",
  }
);

unlinkSync(tmp);

if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(run.status ?? 1);
}
process.stdout.write(run.stdout);