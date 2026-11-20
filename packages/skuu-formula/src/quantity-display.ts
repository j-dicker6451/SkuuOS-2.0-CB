// SPDX-License-Identifier: AGPL-3.0-only

/** % w/w — always 4 dp in Skuu UI. */
export function formatPercentWw4(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${percent.toFixed(4)}%`;
}

/** Mass for labels: ≥1 kg → 3 dp kg; smaller → whole grams. */
export function formatMassQuantityKg(
  kg: number | null | undefined,
  opts?: { forceUnit?: "kg" | "g" }
): string {
  if (kg == null || !Number.isFinite(kg)) return "—";
  const n = Number(kg);
  if (opts?.forceUnit === "kg") return `${n.toFixed(3)} kg`;
  if (opts?.forceUnit === "g") return `${Math.round(n * 1000)} g`;
  if (Math.abs(n) < 1) return `${Math.round(n * 1000)} g`;
  return `${n.toFixed(3)} kg`;
}

export function formatLiters(
  liters: number | null | undefined,
  dp = 3
): string {
  if (liters == null || !Number.isFinite(liters)) return "—";
  return `${liters.toFixed(dp)} L`;
}

/** MRP / PO: round requirement up to whole kg. */
export function ceilOrderKg(dispenseKg: number): number {
  if (!(dispenseKg > 0)) return 0;
  return Math.ceil(dispenseKg - 1e-9);
}

export function formatDispenseAndOrderKg(
  dispenseKg: number,
  packKg?: number | null
): string {
  const order = (() => {
    let o = ceilOrderKg(dispenseKg);
    if (packKg != null && packKg > 0) {
      o = Math.ceil(o / packKg) * packKg;
    }
    return o;
  })();
  const disp = formatMassQuantityKg(dispenseKg);
  const ord = formatMassQuantityKg(order, { forceUnit: "kg" });
  if (order <= dispenseKg + 1e-6) return disp;
  return `Dispense ${disp}, order ${ord}`;
}