// SPDX-License-Identifier: AGPL-3.0-only

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpikeContext, loadSpikeInput } from "./context";
import { runSpikeFlow } from "./flow";
import { createReporter } from "./report";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function main() {
  const input = loadSpikeInput();
  const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
  const { report, note } = createReporter();
  let ctx: Awaited<ReturnType<typeof buildSpikeContext>> | undefined;

  try {
    ctx = await buildSpikeContext(input, tag);
    note(
      "seed",
      `Company ${ctx.companyId} location ${ctx.locationId} user ${ctx.userId}`
    );
    await runSpikeFlow(ctx, input, note);
  } catch (err) {
    note("error", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    if (ctx?.pool) await ctx.pool.end();
    const reportPath = path.join(__dirname, "report-last-run.txt");
    writeFileSync(
      reportPath,
      report.map((r) => `${r.section}: ${r.message}`).join("\n") + "\n",
      "utf8"
    );
    note("done", `Report written to ${reportPath}`);
  }
}