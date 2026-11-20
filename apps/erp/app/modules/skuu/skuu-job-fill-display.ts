// SPDX-License-Identifier: AGPL-3.0-only

import { formatMassQuantityKg } from "@skuu/formula";

/** Loader-serialized overlay for bulk pull on fill jobs (no DB access). */
export type SkuuFillBulkPullOverlay = {
  bulkItemId: string;
  packSizeMl: number;
  kgPerUnit: number;
  totalKg: number;
};

export function formatSkuuFillBulkPullBadge(overlay: SkuuFillBulkPullOverlay): string {
  return `${overlay.packSizeMl} mL (${formatMassQuantityKg(overlay.kgPerUnit, {
    forceUnit: "kg"
  })}) per unit · total ${formatMassQuantityKg(overlay.totalKg, {
    forceUnit: "kg"
  })}`;
}