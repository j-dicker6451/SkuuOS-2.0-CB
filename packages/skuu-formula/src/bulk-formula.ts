// SPDX-License-Identifier: AGPL-3.0-only
// SkuuOS bulk % w/w formula helpers (AGPL extension).

export const DEFAULT_PERCENT_TOLERANCE = 0.05;

export type PercentLine = { id: string; percentWw: number | null | undefined };

export function sumPercentWw(lines: PercentLine[]): number {
  return lines.reduce((sum, line) => sum + (line.percentWw ?? 0), 0);
}

export function validatePercentSum(
  lines: PercentLine[],
  tolerance = DEFAULT_PERCENT_TOLERANCE
): { ok: boolean; total: number; message?: string } {
  const total = sumPercentWw(lines);
  const ok = Math.abs(100 - total) <= tolerance;
  return ok
    ? { ok: true, total }
    : {
        ok: false,
        total,
        message: `Formula lines must total 100% (±${tolerance}%). Current total: ${total.toFixed(2)}%.`
      };
}

/**
 * Manufacture amount from target finished and expected yield %.
 * Example: 240 L target at 98% → 240 / 0.98.
 */
export function manufactureFromExpectedYield(
  targetAmount: number,
  expectedYieldPercent: number
): number {
  if (!(targetAmount > 0)) return 0;
  if (!(expectedYieldPercent > 0)) return targetAmount;
  return targetAmount / (expectedYieldPercent / 100);
}

/** @deprecated Use manufactureFromExpectedYield with expected yield %. */
export function grossBatchKg(
  targetOutputKg: number,
  yieldLossPercent: number
): number {
  const expected =
    yieldLossPercent > 0 && yieldLossPercent < 100
      ? 100 - yieldLossPercent
      : 100;
  return manufactureFromExpectedYield(targetOutputKg, expected);
}

/** kg = liters × density (g/mL); e.g. 244.898 L × 1.04 = 254.694 kg. */
export function litersToKg(liters: number, densityGPerMl: number): number {
  if (!(liters > 0) || !(densityGPerMl > 0)) return 0;
  return liters * densityGPerMl;
}

export function kgToLiters(kg: number, densityGPerMl: number): number {
  if (!(kg > 0) || !(densityGPerMl > 0)) return 0;
  return kg / densityGPerMl;
}

/** Display dispensed/planned amounts with ≥4 decimal places. */
export function formatDispensedAmounts(
  kg: number,
  percentWw?: number | null
): { kg: string; g: string; percentWw?: string } {
  const fmt = (n: number) => n.toFixed(4);
  const out: { kg: string; g: string; percentWw?: string } = {
    kg: fmt(kg),
    g: fmt(kg * 1000)
  };
  if (percentWw != null && Number.isFinite(percentWw)) {
    out.percentWw = fmt(percentWw);
  }
  return out;
}

/** Multiplier applied to parent batch kg: percent / 100. */
export function percentToQuantityMultiplier(percentWw: number): number {
  return percentWw / 100;
}

/** Line kg for a batch from % w/w and grossed input kg. */
export function lineKgFromPercent(
  percentWw: number,
  grossInputKg: number
): number {
  return (percentWw / 100) * grossInputKg;
}
