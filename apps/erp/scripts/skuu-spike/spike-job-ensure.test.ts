// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { spikeJobHumanIdForAttempt } from "./spike-job-ensure";

describe("ensureSpikeJobCreated id suffixes", () => {
  it("allocates -0002 after base", () => {
    const base = "skuu-product-X-JOB-BULK";
    expect(spikeJobHumanIdForAttempt(base, 0)).toBe(base);
    expect(spikeJobHumanIdForAttempt(base, 1)).toBe(`${base}-0002`);
    expect(spikeJobHumanIdForAttempt(base, 2)).toBe(`${base}-0003`);
  });
});