// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

/**
 * Documents approval side-effect: prior `approved` rows for the same item become
 * `superseded` (enforced in approveSkuuFormulationVersion DB updates).
 */
describe("formulation approval supersede convention", () => {
  it("expects a single approved revision per item after approve", () => {
    const revisions = [
      { makeMethodId: "v1", status: "approved" },
      { makeMethodId: "v2", status: "pending_approval" }
    ];
    const targetId = "v2";
    const after = revisions.map((row) => {
      if (row.status === "approved" && row.makeMethodId !== targetId) {
        return { ...row, status: "superseded" };
      }
      if (row.makeMethodId === targetId) {
        return { ...row, status: "approved" };
      }
      return row;
    });
    expect(after.filter((r) => r.status === "approved")).toHaveLength(1);
    expect(after.find((r) => r.makeMethodId === "v1")?.status).toBe("superseded");
    expect(after.find((r) => r.makeMethodId === "v2")?.status).toBe("approved");
  });
});