// SPDX-License-Identifier: AGPL-3.0-only

import type { SpikeIngredient } from "./context";

/** ERP-style bulk SKU code (shared across runs; teardown via tagged jobs, not item prefix). */
export function bulkItemReadableId(formulaRef: string): string {
  return `BULK-${formulaRef.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

export function fillItemReadableId(formulaRef: string, packSizeMl: number): string {
  return `FG-${formulaRef.replace(/[^a-zA-Z0-9-_]/g, "-")}-${packSizeMl}ML`;
}

export function slugPartCodeFromName(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "RAW-MATERIAL";
}

export function resolveIngredientPartCode(ing: SpikeIngredient): string {
  const explicit = ing.partCode?.trim();
  if (explicit) return explicit;
  return slugPartCodeFromName(ing.name);
}