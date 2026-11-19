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
  it(
    "raw → bulk → fills → ship → trace",
    async () => {
      const input = loadSpikeInput();
      const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
      const { report, note } = createReporter();
      const reportPath = path.join(__dirname, "report-last-run.txt");
      const flushReport = () => {
        writeFileSync(
          reportPath,
          report.map((r) => `${r.section}: ${r.message}`).join("\n") + "\n",
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
    },
    180_000
  );
});