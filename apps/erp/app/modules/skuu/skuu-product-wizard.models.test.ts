// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { wizardFormulaCheck } from "./skuu-product-wizard.models";

describe("Skuu product wizard draft", () => {
  it("requires 100% formula before create", () => {
    const bad = wizardFormulaCheck({
      ingredients: [
        { partCode: "1A", tradeName: "Water", percentWw: 50, phaseNumber: 1 }
      ]
    });
    expect(bad.ok).toBe(false);
    const good = wizardFormulaCheck({
      ingredients: [
        { partCode: "1A", tradeName: "Water", percentWw: 100, phaseNumber: 1 }
      ]
    });
    expect(good.ok).toBe(true);
  });
});