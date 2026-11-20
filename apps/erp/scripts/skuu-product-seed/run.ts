#!/usr/bin/env tsx
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-to-end product seed (gitignored input).
 *
 *   SKUU_PRODUCT_INPUT=scripts/skuu-spike/bld-bro-night.local.json pnpm skuu:product-seed
 */

import { bootstrapSpikeEnv } from "../skuu-spike/env-bootstrap";
import { buildSpikeContext, loadSpikeInput } from "../skuu-spike/context";
import { runSpikeFlow } from "../skuu-spike/flow";
import { createReporter } from "../skuu-spike/report";

bootstrapSpikeEnv();

const tag = process.env.SKUU_SPIKE_PREFIX ?? "skuu-spike";
const input = loadSpikeInput();
const { note } = createReporter();

async function main() {
  const ctx = await buildSpikeContext(input, tag);
  try {
    await runSpikeFlow(ctx, input, note);
    console.log("Skuu product seed complete.");
  } finally {
    await ctx.pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});