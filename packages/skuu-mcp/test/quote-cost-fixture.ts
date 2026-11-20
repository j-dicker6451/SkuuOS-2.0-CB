// SPDX-License-Identifier: AGPL-3.0-only

import { evaluateLineCosts, totalUnitCost, type LineCosts } from "@skuu/readonly";

type CostEffect = (q: number) => number;

export function emptyEffectsFixture() {
  return {
    materialCost: [] as CostEffect[],
    partCost: [] as CostEffect[],
    toolCost: [] as CostEffect[],
    consumableCost: [] as CostEffect[],
    serviceCost: [] as CostEffect[],
    laborCost: [] as CostEffect[],
    machineCost: [] as CostEffect[],
    overheadCost: [] as CostEffect[],
    outsideCost: [] as CostEffect[],
    setupHours: [] as CostEffect[],
    laborHours: [] as CostEffect[],
    machineHours: [] as CostEffect[]
  };
}

export { evaluateLineCosts, totalUnitCost, type LineCosts };