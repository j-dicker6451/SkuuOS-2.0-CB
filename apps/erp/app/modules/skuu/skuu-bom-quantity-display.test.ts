// SPDX-License-Identifier: AGPL-3.0-only

import {
  formatMassQuantityKg,
  grossInputKg,
  lineKgFromPercent
} from "@skuu/formula";
import { describe, expect, it } from "vitest";
import { formatSkuuBulkBomLineQuantityLabel } from "./skuu-bom-quantity-display";

describe("formatSkuuBulkBomLineQuantityLabel", () => {
  it("formats percent and line kg for a bulk job batch", () => {
    const targetFinishedKg = 254.694;
    const yieldPct = 98;
    const pct = 62.76;
    const gross = grossInputKg(targetFinishedKg, yieldPct);
    const kg = lineKgFromPercent(pct, gross);
    expect(
      formatSkuuBulkBomLineQuantityLabel(pct, targetFinishedKg, yieldPct)
    ).toBe(
      `62.76% · ${formatMassQuantityKg(kg, { forceUnit: "kg" })}`
    );
  });
});