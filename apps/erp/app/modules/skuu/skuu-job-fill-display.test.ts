// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  formatSkuuFillBulkPullBadge,
  type SkuuFillBulkPullOverlay
} from "./skuu-job-fill-display";

describe("formatSkuuFillBulkPullBadge", () => {
  it("formats pack size, per-unit kg, and total bulk pull", () => {
    const overlay: SkuuFillBulkPullOverlay = {
      bulkItemId: "bulk-1",
      packSizeMl: 250,
      kgPerUnit: 0.2496,
      totalKg: 249.6
    };
    expect(formatSkuuFillBulkPullBadge(overlay)).toBe(
      "250 mL (0.250 kg) per unit · total 249.600 kg"
    );
  });
});