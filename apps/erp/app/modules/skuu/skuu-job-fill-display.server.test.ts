// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { loadSkuuFillBulkPullOverlay } from "./skuu-job-fill-display.server";

function mockClient(overrides?: {
  jobQuantity?: number;
  lineKg?: number;
  fgReadable?: string;
}) {
  const jobQuantity = overrides?.jobQuantity ?? 16_000;
  const lineKg = overrides?.lineKg ?? 249.6;
  const fgReadable = overrides?.fgReadable ?? "SKUU-VITC-15ML";

  const builder: Record<string, unknown> = {};
  const self = () => builder;
  const chain = () => {
    builder.select = vi.fn(self);
    builder.eq = vi.fn(self);
    builder.limit = vi.fn(self);
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data:
          builder._table === "job"
            ? {
                quantity: jobQuantity,
                itemId: "fg_item",
                item: { readableIdWithRevision: fgReadable }
              }
            : {
                itemId: "bulk_item",
                quantity: lineKg,
                estimatedQuantity: lineKg
              },
        error: null
      })
    );
    return builder;
  };
  chain();

  return {
    from: vi.fn((table: string) => {
      builder._table = table;
      return chain();
    })
  } as never;
}

describe("loadSkuuFillBulkPullOverlay", () => {
  it("treats pull line quantity as total bulk kg and derives per unit", async () => {
    const overlay = await loadSkuuFillBulkPullOverlay(mockClient(), {
      jobId: "job_fill",
      companyId: "co_test"
    });
    expect(overlay?.packSizeMl).toBe(15);
    expect(overlay?.kgPerUnit).toBe(0.016);
    expect(overlay?.totalKg).toBe(249.6);
  });
});