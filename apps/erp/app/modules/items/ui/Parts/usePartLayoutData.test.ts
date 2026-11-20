// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { resolvePartLayoutDataFromMatches } from "./usePartLayoutData";

const bulkId = "item_EL64Jer7rGqUo2jN7a7GHq";
const partSummary = {
  id: bulkId,
  readableId: "BULK-PLUS01-18-T",
  replenishmentSystem: "Make",
  itemTrackingType: "Lot",
  unitOfMeasureCode: "kg"
};

describe("resolvePartLayoutDataFromMatches", () => {
  it("falls back to the parent $itemId match on nested formulation", () => {
    const matches = [
      {
        data: { partSummary },
        params: { itemId: bulkId }
      },
      {
        data: { makeMethodId: null, view: null },
        params: { itemId: bulkId }
      }
    ];

    expect(
      resolvePartLayoutDataFromMatches(bulkId, undefined, matches)
    ).toEqual({ partSummary });
  });

  it("prefers an exact parent-path match when present", () => {
    const exact = { partSummary, tag: "exact" };
    expect(
      resolvePartLayoutDataFromMatches(bulkId, exact, [
        { data: { partSummary }, params: { itemId: bulkId } }
      ])
    ).toBe(exact);
  });

  it("ignores a different itemId on the parent match", () => {
    expect(
      resolvePartLayoutDataFromMatches(bulkId, undefined, [
        {
          data: { partSummary },
          params: { itemId: "other" }
        }
      ])
    ).toBeUndefined();
  });
});
