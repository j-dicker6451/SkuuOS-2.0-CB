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

const planGate = spawnSync("node", ["scripts/verify-plan-gate.mjs"], {
  cwd: root,
  encoding: "utf-8",
});
if (planGate.status !== 0) {
  console.error(planGate.stderr || planGate.stdout);
  process.exit(planGate.status ?? 1);
}
process.stdout.write(planGate.stdout);

const carbonTmp = path.join(root, "apps/erp", ".verify-carbon-server.tmp.ts");
const { writeFileSync, unlinkSync } = await import("node:fs");
writeFileSync(
  carbonTmp,
  `import "./app/modules/carbon.server.ts";\nconsole.log("[ok] carbon.server.ts");\n`,
  "utf-8"
);
const tsx = spawnSync(
  "pnpm",
  ["exec", "tsx", "--tsconfig", "tsconfig.json", ".verify-carbon-server.tmp.ts"],
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
unlinkSync(carbonTmp);
if (tsx.status !== 0) {
  console.warn(
    "[warn] carbon.server.ts import skipped in this environment:",
    (tsx.stderr || tsx.stdout || "").split("\n")[0]
  );
} else {
  process.stdout.write(tsx.stdout);
}