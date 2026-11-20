// SPDX-License-Identifier: AGPL-3.0-only

import { getItemById, getMaterialDescription } from "@carbon/utils";
import type { Item } from "~/stores";

/**
 * Skuu/cosmetic materials use explicit trade names on `item.name`.
 * When present, never show metalwork-generated substance+shape text.
 */
export function itemTradeDisplayName(
  opts: {
    name?: string | null;
    description?: string | null;
    materialSubstance?: string | null;
    materialForm?: string | null;
  },
  items?: Item[],
  itemId?: string | null
): string {
  const fromName = opts.name?.trim();
  if (fromName) return fromName;

  if (itemId && items?.length) {
    const cached = getItemById(items, itemId)?.name?.trim();
    if (cached) return cached;
  }

  const generated =
    opts.materialSubstance && opts.materialForm
      ? getMaterialDescription({
          substance: opts.materialSubstance,
          shape: opts.materialForm
        }).trim()
      : "";

  const desc = opts.description?.trim();
  if (desc && desc !== generated) return desc;
  if (desc && !generated) return desc;

  return fromName ?? "";
}

export function formatSkuuMaterialLotCodes(
  lots: Array<{
    trackedEntityReadableId?: string | null;
    supplierBatchNumber?: string | null;
    quantityKg?: number | null;
  }>
): string {
  if (!lots.length) return "";
  return lots
    .map((lot) => {
      const id = lot.trackedEntityReadableId?.trim();
      const sup = lot.supplierBatchNumber?.trim();
      const qty =
        lot.quantityKg != null && lot.quantityKg > 0
          ? ` (${Number(lot.quantityKg).toFixed(4)} kg)`
          : "";
      if (id && sup) return `${id} · ${sup}${qty}`;
      if (id) return `${id}${qty}`;
      if (sup) return sup + qty;
      return "";
    })
    .filter(Boolean)
    .join("; ");
}