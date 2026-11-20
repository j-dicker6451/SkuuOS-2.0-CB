// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { normalizeSpikeInput } from "../../../scripts/skuu-spike/context";

describe("normalizeSpikeInput (product seed JSON)", () => {
  it("maps method / methodText phase keys to instructions", () => {
    const input = normalizeSpikeInput({
      product: "X",
      formulaRef: "REF",
      version: "1",
      batchKg: 1,
      expectedYieldPercent: 100,
      productDensityGPerMl: 1,
      ingredients: [],
      phases: [
        { phaseNumber: 1, method: "Heat main vessel to 75°C." },
        { phaseNumber: 2, methodText: "Cool; add preservative." }
      ]
    });
    expect(input.phases?.[0]?.instructions).toBe("Heat main vessel to 75°C.");
    expect(input.phases?.[1]?.instructions).toBe("Cool; add preservative.");
  });
});