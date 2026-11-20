// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product seed runs via Vitest (same module resolution as `pnpm skuu:spike`).
 *
 *   SKUU_PRODUCT_INPUT=apps/erp/scripts/skuu-spike/bld-bro-night.local.json pnpm skuu:product-seed
 *
 * Implementation: `product-seed.e2e.test.ts` + `vitest.product-seed.config.ts`.
 * Teardown is skipped so bulk/FG/jobs remain for UI walkthrough.
 */

export {};