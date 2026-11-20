// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  buildSkuuPhasedFormulaBlocks,
  mergeSkuuFormulaPhases,
  SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER
} from "./skuu-phased-formula";

describe("skuu phased formula", () => {
  it("always includes phase 1 with placeholder when no phase rows exist", () => {
    const merged = mergeSkuuFormulaPhases(
      [],
      [
        {
          methodMaterialId: "mm1",
          itemId: "i1",
          itemReadableId: "1A102",
          itemName: "Water DI",
          itemType: "Material",
          percentWw: 100,
          phaseNumber: 1,
          lineKind: "ingredient"
        }
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.instructions).toBe(SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER);
  });

  it("groups lines under phases for BOM display", () => {
    const blocks = buildSkuuPhasedFormulaBlocks(
      [
        {
          phaseNumber: 1,
          instructions: "Heat water",
          methodOperationId: null
        },
        {
          phaseNumber: 2,
          instructions: "Neutralise",
          methodOperationId: null
        }
      ],
      [
        {
          methodMaterialId: "a",
          itemId: "i1",
          itemReadableId: "1A1",
          itemName: "Water",
          itemType: "Material",
          percentWw: 90,
          phaseNumber: 1,
          lineKind: "ingredient"
        },
        {
          methodMaterialId: "b",
          itemId: "i2",
          itemReadableId: "1A2",
          itemName: "Carbopol",
          itemType: "Material",
          percentWw: 10,
          phaseNumber: 2,
          lineKind: "ingredient"
        }
      ],
      {
        enabled: true,
        batchBasisKg: 100,
        yieldLossPercent: 0,
        productDensityGPerMl: 1,
        expectedYieldPercent: 100
      }
    );
    expect(blocks[0]?.lines).toHaveLength(1);
    expect(blocks[1]?.lines).toHaveLength(1);
    expect(blocks[0]?.lines[0]?.itemName).toBe("Water");
  });
});