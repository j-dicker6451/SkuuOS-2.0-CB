// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { buildSkuuPhasedFormulaBlocks } from "./skuu-phased-formula";
import type { SkuuFormulationMaterialLine } from "./skuu-formulation.service";

describe("buildSkuuPhasedFormulaBlocks", () => {
  it("keeps duplicate item on separate lines per phase", () => {
    const materials: SkuuFormulationMaterialLine[] = [
      {
        methodMaterialId: "mm-water-1",
        itemId: "item-water",
        itemReadableId: "1A92",
        itemName: "Water DI",
        itemType: "Material",
        percentWw: 62.76,
        phaseNumber: 1,
        lineKind: "ingredient",
        order: 1
      },
      {
        methodMaterialId: "mm-water-6",
        itemId: "item-water",
        itemReadableId: "1A92",
        itemName: "Water DI",
        itemType: "Material",
        percentWw: 0.4,
        phaseNumber: 6,
        lineKind: "ingredient",
        order: 2
      }
    ];
    const blocks = buildSkuuPhasedFormulaBlocks(
      [{ phaseNumber: 1, instructions: "A", methodOperationId: null }],
      materials,
      {
        enabled: true,
        batchBasisKg: 249.6,
        expectedYieldPercent: 98,
        productDensityGPerMl: 1.04
      }
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lines).toHaveLength(1);
    expect(blocks[1]!.lines).toHaveLength(1);
    expect(blocks[0]!.lines[0]!.methodMaterialId).toBe("mm-water-1");
    expect(blocks[1]!.lines[0]!.methodMaterialId).toBe("mm-water-6");
  });
});