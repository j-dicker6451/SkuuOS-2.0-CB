// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  allocateTrackedIssueDraws,
  buildTrackedIssueChildren
} from "./spike-mes";

describe("allocateTrackedIssueDraws", () => {
  it("caps each draw at lot qty and full-consumes the smaller lot first", () => {
    const lots = [
      { id: "lot-a", quantity: 0.375 },
      { id: "lot-b", quantity: 0.15 }
    ];
    const need = 0.35714;
    const draws = allocateTrackedIssueDraws(lots, need);
    expect(draws).toHaveLength(2);
    expect(draws[0]).toMatchObject({
      trackedEntityId: "lot-b",
      quantity: 0.15
    });
    expect(draws[1]!.trackedEntityId).toBe("lot-a");
    const sum = draws.reduce((acc, d) => acc + d.quantity, 0);
    expect(sum).toBeCloseTo(need, 4);
    expect(draws[1]!.quantity).toBeLessThan(lots[0]!.quantity);
  });

  it("buildTrackedIssueChildren uses one Available lot for normal materials", () => {
    const lots = [{ id: "lot-only", quantity: 5 }];
    const draws = buildTrackedIssueChildren(lots, 0.5, false);
    expect(draws).toEqual([{ trackedEntityId: "lot-only", quantity: 0.5 }]);
  });
});