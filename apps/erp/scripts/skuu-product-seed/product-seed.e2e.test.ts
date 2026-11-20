// SPDX-License-Identifier: AGPL-3.0-only

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bootstrapSpikeEnv } from "../skuu-spike/env-bootstrap";
import { buildSpikeContext, loadSpikeInput } from "../skuu-spike/context";
import { buildBulkBatchTicket } from "~/modules/skuu/skuu-batch-ticket.server";
import { runSpikeFlow } from "../skuu-spike/flow";
import { createReporter } from "../skuu-spike/report";
import { hasLocalDatabase } from "../../test/database/fixtures/local-database";

bootstrapSpikeEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, "..", "skuu-spike", "report-product-seed.txt");
const demoFixture = path.join(
  __dirname,
  "..",
  "skuu-spike",
  "fixtures",
  "demo-serum.json"
);

describe.skipIf(!hasLocalDatabase)("SkuuOS product seed (e2e)", () => {
  it(
    "seed product from committed demo-serum fixture and leave rows in ERP",
    async () => {
      if (!process.env.SKUU_PRODUCT_INPUT) {
        process.env.SKUU_PRODUCT_INPUT = demoFixture;
      }
      const input = loadSpikeInput();
      const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-product";
      const { report, note } = createReporter();
      let ctx: Awaited<ReturnType<typeof buildSpikeContext>> | undefined;
      try {
        ctx = await buildSpikeContext(input, tag);
        note("seed", `Company ${ctx.companyId} prefix ${ctx.prefix}`);
        await runSpikeFlow(ctx, input, note, { skipTeardown: true });
        await runSpikeFlow(ctx, input, note, { skipTeardown: true });
        const bulkHumanId = `${ctx.prefix}-JOB-BULK`;
        const bulkJobRow = await ctx.db
          .selectFrom("job")
          .select("id")
          .where("companyId", "=", ctx.companyId)
          .where("jobId", "=", bulkHumanId)
          .executeTakeFirst();
        expect(bulkJobRow, `bulk job ${bulkHumanId}`).toBeDefined();
        const ticket = await buildBulkBatchTicket(
          ctx.service.asSystem.supabase,
          { jobId: bulkJobRow!.id, companyId: ctx.companyId }
        );
        expect(ticket, "buildBulkBatchTicket for seeded bulk job").not.toBeNull();
        expect(ticket!.phases.some((p) => p.instructions.length > 0)).toBe(
          Boolean(input.phases?.length)
        );
        writeFileSync(
          reportPath,
          report.map((r) => `${r.section}: ${r.message}`).join("\n") + "\n",
          "utf8"
        );
        const errorLine = report.find((r) => r.section === "error");
        expect(errorLine, reportPath).toBeUndefined();
      } catch (err) {
        note("error", err instanceof Error ? err.message : String(err));
        writeFileSync(
          reportPath,
          report.map((r) => `${r.section}: ${r.message}`).join("\n") + "\n",
          "utf8"
        );
        throw err;
      } finally {
        await ctx?.pool.end();
      }
    },
    240_000
  );
});