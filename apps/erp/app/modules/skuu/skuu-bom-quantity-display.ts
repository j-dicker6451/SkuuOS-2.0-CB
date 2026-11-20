// SPDX-License-Identifier: AGPL-3.0-only

import {
  formatMassQuantityKg,
  formatPercentWw,
  grossInputKg,
  lineKgFromPercent
} from "@skuu/formula";

/** Display-only badge for Skuu bulk BOM lines (% w/w · batch kg at 3 dp). */
export function formatSkuuBulkBomLineQuantityLabel(
  percentWw: number,
  targetFinishedKg: number,
  expectedYieldPercent: number,
  opts?: { standardBatch?: boolean }
): string {
  const gross = grossInputKg(targetFinishedKg, expectedYieldPercent);
  const kg = lineKgFromPercent(percentWw, gross);
  const kgLabel = formatMassQuantityKg(kg, { forceUnit: "kg" });
  const base = `${formatPercentWw(percentWw)} · ${kgLabel}`;
  return opts?.standardBatch ? `${base} / batch` : base;
}