// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  ceilOrderKg,
  formatDispenseAndOrderKg,
  formatLiters,
  formatMassQuantityKg,
  formatPercentWw,
  formatPercentWw4,
  formatSkuuGrossBatchLabel
} from "./quantity-display";

describe("quantity-display", () => {
  it("formats % w/w to 2 dp", () => {
    expect(formatPercentWw(62.76)).toBe("62.76%");
    expect(formatPercentWw(0.4)).toBe("0.40%");
  });

  it("formats % w/w to 4 dp", () => {
    expect(formatPercentWw4(62.76)).toBe("62.7600%");
    expect(formatPercentWw4(0.4)).toBe("0.4000%");
  });

  it("formats mass with kg vs g threshold", () => {
    expect(formatMassQuantityKg(159.844)).toBe("159.844 kg");
    expect(formatMassQuantityKg(0.357)).toBe("357 g");
  });

  it("ceilOrderKg rounds up for MRP", () => {
    expect(ceilOrderKg(0.357)).toBe(1);
    expect(ceilOrderKg(2.0)).toBe(2);
  });

  it("formatDispenseAndOrderKg shows order when above dispense", () => {
    expect(formatDispenseAndOrderKg(0.357)).toBe(
      "Dispense 357 g, order 1.000 kg"
    );
  });

  it("formatLiters", () => {
    expect(formatLiters(244.898)).toBe("244.898 L");
  });

  it("formatSkuuGrossBatchLabel (PLUS01-scale batch)", () => {
    expect(
      formatSkuuGrossBatchLabel({
        targetFinishedKg: 249.6,
        expectedYieldPercent: 98,
        productDensityGPerMl: 1.04
      })
    ).toBe("254.694 kg (244.9 L)");
  });
});