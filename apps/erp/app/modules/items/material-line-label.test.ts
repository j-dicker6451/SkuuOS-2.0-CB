// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  formatSkuuMaterialLotCodes,
  itemTradeDisplayName
} from "./material-line-label";

describe("itemTradeDisplayName", () => {
  it("prefers item.name over metalwork-generated description", () => {
    expect(
      itemTradeDisplayName({
        name: "Carbopol Ultrez 21 Polymer",
        description: "Cosmetic raw material Bulk",
        materialSubstance: "Cosmetic raw material",
        materialForm: "Bulk"
      })
    ).toBe("Carbopol Ultrez 21 Polymer");
  });

  it("formats multiple lot refs", () => {
    expect(
      formatSkuuMaterialLotCodes([
        {
          trackedEntityReadableId: "LOT-A",
          supplierBatchNumber: "SB-1",
          quantityKg: 2.5
        },
        { trackedEntityReadableId: "LOT-B", supplierBatchNumber: "SB-2" }
      ])
    ).toContain("LOT-A · SB-1");
  });
});