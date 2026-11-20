// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mapFormulaLinesToJobMaterials } from "./skuu-job-formula-job-material";

describe("mapFormulaLinesToJobMaterials", () => {
  it("maps duplicate item lines by order", () => {
    const map = mapFormulaLinesToJobMaterials(
      [
        {
          methodMaterialId: "mm_water_p1",
          itemId: "item_water",
          order: 1
        },
        {
          methodMaterialId: "mm_water_p6",
          itemId: "item_water",
          order: 6
        }
      ],
      [
        { id: "jm_water_p1", itemId: "item_water", order: 1 },
        { id: "jm_water_p6", itemId: "item_water", order: 6 }
      ]
    );
    expect(map.get("mm_water_p1")).toBe("jm_water_p1");
    expect(map.get("mm_water_p6")).toBe("jm_water_p6");
  });

  it("maps a unique item without order when only one formula line exists", () => {
    const map = mapFormulaLinesToJobMaterials(
      [{ methodMaterialId: "mm_zemea", itemId: "item_z", order: 2 }],
      [{ id: "jm_z", itemId: "item_z", order: 99 }]
    );
    expect(map.get("mm_zemea")).toBe("jm_z");
  });
});