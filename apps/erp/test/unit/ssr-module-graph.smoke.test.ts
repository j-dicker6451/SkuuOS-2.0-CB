// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

/**
 * Guards the SSR import graph (entry.server → carbon.server → router.server → modules).
 * A bad top-level import (e.g. undefined zfd) must fail here before dev server boot.
 */
describe("SSR module graph smoke", () => {
  it("loads skuu form validators", async () => {
    const mod = await import("~/modules/skuu/skuu.models");
    expect(mod.skuuBulkProfileValidator).toBeDefined();
    expect(mod.skuuBulkProfileValidator.shape.enabled).toBeDefined();
  });

  it(
    "loads skuu.server (router import graph) without throwing",
    async () => {
      const mod = await import("~/modules/skuu/skuu.server");
      expect(mod.saveSkuuBulkProfile).toBeDefined();
    },
    30_000
  );
});