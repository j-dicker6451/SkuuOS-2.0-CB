// SPDX-License-Identifier: AGPL-3.0-only

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { bootstrapSpikeEnv } from "./env-bootstrap";
import { buildSpikeContext, loadSpikeInput } from "./context";
import { runSpikeFlow } from "./flow";
import { createReporter } from "./report";
import { hasLocalDatabase } from "../../test/database/fixtures/local-database";

bootstrapSpikeEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe.skipIf(!hasLocalDatabase)("SkuuOS formula spike (e2e)", () => {
  const reportPath = path.join(__dirname, "report-last-run.txt");

  async function runOnce(runLabel: string) {
    const input = loadSpikeInput();
    const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
    const { report, note } = createReporter();
    const flushReport = () => {
      writeFileSync(
        reportPath,
        [`=== ${runLabel} ===`, ...report.map((r) => `${r.section}: ${r.message}`)].join(
          "\n"
        ) + "\n",
        "utf8"
      );
    };
    let ctx: Awaited<ReturnType<typeof buildSpikeContext>> | undefined;
    try {
      ctx = await buildSpikeContext(input, tag);
      await runSpikeFlow(ctx, input, note);
      flushReport();
      const errorLine = report.find((r) => r.section === "error");
      expect(errorLine, reportPath).toBeUndefined();
    } catch (err) {
      note("error", err instanceof Error ? err.message : String(err));
      flushReport();
      throw err;
    } finally {
      await ctx?.pool.end();
    }
  }

  it(
    "raw (Material) → bulk → cross-product bulk → fills → ship → trace",
    () => runOnce("run-1"),
    240_000
  );

  it(
    "rerun from dirty state",
    () => runOnce("run-2"),
    240_000
  );
});