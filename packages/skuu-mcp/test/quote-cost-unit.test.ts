// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  emptyEffectsFixture,
  evaluateLineCosts,
  totalUnitCost
} from "./quote-cost-fixture";

describe("quote line cost rollup (useLineCosts parity)", () => {
  it("amortises fixed setup over quantity breaks", () => {
    const effects = emptyEffectsFixture();
    effects.laborCost.push((q) => 100 + 2 * q);
    const small = evaluateLineCosts(effects, 10);
    const large = evaluateLineCosts(effects, 1000);
    expect(totalUnitCost(small, 10)).toBeGreaterThan(totalUnitCost(large, 1000));
  });
});