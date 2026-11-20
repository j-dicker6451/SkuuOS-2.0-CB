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
      packSizeMl: 15,
      kgPerUnit: 0.016,
      totalKg: 249.6
    };
    expect(formatSkuuFillBulkPullBadge(overlay)).toBe(
      "15 mL (0.016 kg) per unit · total 249.600 kg"
    );
  });
});