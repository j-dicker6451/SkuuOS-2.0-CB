// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Manual / CI smoke: import the SSR entry graph (same chain that 500s on bad module init).
 *   pnpm --filter erp exec tsx scripts/ssr-import.smoke.ts
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

await import("../app/modules/router.server.ts");
await import("../app/entry.server.tsx");

console.log("SSR import smoke: entry.server + router.server OK");