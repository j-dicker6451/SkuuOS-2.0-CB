// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  formatDispensedAmounts,
  grossInputKg,
  grossMethodQuantityMultiplier,
  lineKgFromPercent,
  litersToKg,
  manufactureFromExpectedYield,
  validatePercentSum
} from "./bulk-formula";

describe("validatePercentSum", () => {
  it("accepts 100% within tolerance", () => {
    expect(
      validatePercentSum([
        { id: "a", percentWw: 45 },
        { id: "b", percentWw: 55 }
      ])
    ).toMatchObject({ ok: true, total: 100 });
  });

  it("rejects totals outside tolerance", () => {
    expect(
      validatePercentSum([{ id: "a", percentWw: 40 }], 0.01)
    ).toMatchObject({ ok: false });
  });
});

describe("manufactureFromExpectedYield", () => {
  it("240 L target at 98% yield", () => {
    expect(manufactureFromExpectedYield(240, 98)).toBeCloseTo(244.898, 2);
  });

  it("leaves quantity at 100% yield", () => {
    expect(manufactureFromExpectedYield(250, 100)).toBe(250);
  });
});

describe("litersToKg", () => {
  it("244.898 L at 1.04 g/mL", () => {
    expect(litersToKg(244.898, 1.04)).toBeCloseTo(254.694, 2);
  });
});

describe("formatDispensedAmounts", () => {
  it("shows kg, g and percent with 4 decimals", () => {
    expect(formatDispensedAmounts(2.251, 12.3456)).toEqual({
      kg: "2.2510",
      g: "2251.0000",
      percentWw: "12.3456"
    });
  });
});

describe("lineKgFromPercent", () => {
  it("scales decimal kg for a batch", () => {
    const gross = manufactureFromExpectedYield(250, 100);
    expect(lineKgFromPercent(12.5, gross)).toBeCloseTo(31.25, 4);
  });
});

describe("grossMethodQuantityMultiplier", () => {
  it("100 kg job at 98% yield sums to gross input kg", () => {
    const yieldPct = 98;
    const lines = [
      { percentWw: 90.5 },
      { percentWw: 9.5 }
    ];
    const jobQty = 100;
    const grossTarget = grossInputKg(jobQty, yieldPct);
    const sumFromMultipliers = lines.reduce(
      (acc, line) =>
        acc + grossMethodQuantityMultiplier(line.percentWw, yieldPct) * jobQty,
      0
    );
    expect(sumFromMultipliers).toBeCloseTo(grossTarget, 4);
    expect(grossTarget).toBeCloseTo(102.0408, 4);
  });
});
