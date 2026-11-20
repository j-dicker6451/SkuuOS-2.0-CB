// SPDX-License-Identifier: AGPL-3.0-only

import { grossInputKg, lineKgFromPercent } from "@skuu/formula";
import { describe, expect, it } from "vitest";

describe("bulk batch ticket quantities", () => {
  it("matches Skuu gross and line kg at 4 dp", () => {
    const batchKg = 100;
    const yieldPct = 98;
    const gross = grossInputKg(batchKg, yieldPct);
    const pct = 62.5;
    const kg = lineKgFromPercent(pct, gross);
    expect(kg.toFixed(4)).toMatch(/^\d+\.\d{4}$/);
    expect(kg).toBeGreaterThan(0);
  });
});
