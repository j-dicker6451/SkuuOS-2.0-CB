// SPDX-License-Identifier: AGPL-3.0-only

import {
  buildSupplierPriceMap,
  type SupplierPartPricing,
  type SupplierPriceMap
} from "@carbon/database/supplier-part-price";
import { sql } from "kysely";
import type { ReadonlyDb } from "./db";

export type { SupplierPriceMap };

export function lookupPriceFromBreaks(
  priceBreaks: { quantity: number; unitPrice: number }[],
  requestedQty: number,
  fallbackPrice: number
): number {
  const eligible = priceBreaks.filter((pb) => pb.quantity <= requestedQty);
  if (eligible.length) {
    return eligible.reduce((best, pb) =>
      pb.quantity > best.quantity ? pb : best
    ).unitPrice;
  }
  return fallbackPrice;
}

export function lookupBuyPriceFromMap(
  itemId: string,
  requestedQty: number,
  priceMap: SupplierPriceMap,
  fallbackCost: number
): number {
  const entry = priceMap[itemId];
  if (!entry) return fallbackCost;
  return lookupPriceFromBreaks(
    entry.priceBreaks,
    requestedQty,
    entry.fallbackUnitPrice ?? fallbackCost
  );
}

/** Same rules as quote UI `resolveBuyUnitCost` (typed manual cost wins). */
export function resolveBuyUnitCost(
  material: {
    itemId: string;
    unitCost: number;
    unitCostSource?: string | null;
  },
  requestedQty: number,
  priceMap: SupplierPriceMap
): number {
  if (material.unitCostSource === "manual") return material.unitCost;
  return lookupBuyPriceFromMap(
    material.itemId,
    requestedQty,
    priceMap,
    material.unitCost
  );
}

export async function loadSupplierPriceMap(
  db: ReadonlyDb,
  companyId: string,
  itemIds: string[]
): Promise<SupplierPriceMap> {
  if (itemIds.length === 0) return {};

  const parts = await db
    .selectFrom("supplierPart")
    .select([
      "id",
      "itemId",
      "currencyCode",
      "conversionFactor",
      "supplierUnitPrice"
    ])
    .where("companyId", "=", companyId)
    .where("itemId", "in", itemIds)
    .execute();

  if (!parts.length) return {};

  const partIds = parts.map((p) => p.id);
  const breaks = await db
    .selectFrom("supplierPartPrice")
    .select(["supplierPartId", "quantity", "supplierUnitPrice"])
    .where("companyId", "=", companyId)
    .where("supplierPartId", "in", partIds)
    .execute();

  const company = await db
    .selectFrom("company")
    .select("baseCurrencyCode")
    .where("id", "=", companyId)
    .executeTakeFirstOrThrow();

  const { rows: rateRows } = await sql<{
    currencyCode: string;
    rate: number;
  }>`
    SELECT * FROM get_exchange_rates(p_company_id := ${companyId}::text)
  `.execute(db);

  const exchangeRates: Record<string, number> = {};
  for (const r of rateRows ?? []) {
    exchangeRates[r.currencyCode] = Number(r.rate);
  }

  const breaksByPart = new Map<string, SupplierPartPricing["priceBreaks"]>();
  for (const row of breaks) {
    const list = breaksByPart.get(row.supplierPartId) ?? [];
    list.push({
      quantity: Number(row.quantity),
      supplierUnitPrice: Number(row.supplierUnitPrice)
    });
    breaksByPart.set(row.supplierPartId, list);
  }

  const pricing: SupplierPartPricing[] = parts.map((sp) => ({
    itemId: sp.itemId,
    currencyCode: sp.currencyCode,
    conversionFactor:
      sp.conversionFactor != null ? Number(sp.conversionFactor) : null,
    supplierUnitPrice:
      sp.supplierUnitPrice != null ? Number(sp.supplierUnitPrice) : null,
    priceBreaks: breaksByPart.get(sp.id) ?? []
  }));

  return buildSupplierPriceMap(
    pricing,
    exchangeRates,
    company.baseCurrencyCode ?? "USD"
  );
}
