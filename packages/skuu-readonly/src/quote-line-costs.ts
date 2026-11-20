// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import {
  loadSupplierPriceMap,
  resolveBuyUnitCost,
  type SupplierPriceMap
} from "./buy-price";
import type { ReadonlyDb } from "./db";

/** Mirrors ERP `Costs` / `useLineCosts` — quantity-aware (setup amortised per break). */
export type LineCosts = {
  consumableCost: number;
  laborCost: number;
  laborHours: number;
  machineCost: number;
  machineHours: number;
  materialCost: number;
  overheadCost: number;
  outsideCost: number;
  partCost: number;
  serviceCost: number;
  setupHours: number;
  toolCost: number;
};

export const costCategoryKeys = [
  "materialCost",
  "partCost",
  "toolCost",
  "consumableCost",
  "serviceCost",
  "laborCost",
  "machineCost",
  "overheadCost",
  "outsideCost"
] as const;

type CostEffect = (outerQty: number) => number;
type CostEffects = Record<(typeof costCategoryKeys)[number], CostEffect[]> & {
  setupHours: CostEffect[];
  laborHours: CostEffect[];
  machineHours: CostEffect[];
};

export type QuoteMethodRow = {
  methodMaterialId: string;
  parentMaterialId: string | null;
  quoteMaterialMakeMethodId: string;
  itemId: string;
  itemType: string;
  methodType: string;
  quantity: number;
  unitCost: number;
  unitCostSource: string | null;
};

export type QuoteOperationRow = {
  quoteMakeMethodId: string | null;
  operationType: string;
  setupTime: number;
  setupUnit: string;
  laborTime: number;
  laborUnit: string;
  laborRate: number;
  machineTime: number;
  machineUnit: string;
  machineRate: number | null;
  overheadRate: number;
  operationUnitCost: number;
  operationMinimumCost: number;
};

function normalizeTime(
  time: number,
  unit: string
): { fixedHours: number; hoursPerUnit: number } {
  let fixedHours = 0;
  let hoursPerUnit = 0;
  switch (unit) {
    case "Total Hours":
      fixedHours = time;
      break;
    case "Total Minutes":
      fixedHours = time / 60;
      break;
    case "Hours/Piece":
      hoursPerUnit = time;
      break;
    case "Hours/100 Pieces":
      hoursPerUnit = time / 100;
      break;
    case "Hours/1000 Pieces":
      hoursPerUnit = time / 1000;
      break;
    case "Minutes/Piece":
      hoursPerUnit = time / 60;
      break;
    case "Minutes/100 Pieces":
      hoursPerUnit = time / 100 / 60;
      break;
    case "Minutes/1000 Pieces":
      hoursPerUnit = time / 1000 / 60;
      break;
    case "Pieces/Hour":
      hoursPerUnit = time > 0 ? 1 / time : 0;
      break;
    case "Pieces/Minute":
      hoursPerUnit = time > 0 ? 1 / (time / 60) : 0;
      break;
    case "Seconds/Piece":
      hoursPerUnit = time / 3600;
      break;
    default:
      break;
  }
  return { fixedHours, hoursPerUnit };
}

function emptyEffects(): CostEffects {
  return {
    materialCost: [],
    partCost: [],
    toolCost: [],
    consumableCost: [],
    serviceCost: [],
    laborCost: [],
    machineCost: [],
    overheadCost: [],
    outsideCost: [],
    setupHours: [],
    laborHours: [],
    machineHours: []
  };
}

function pushBuyCostEffect(
  effects: CostEffects,
  itemId: string,
  itemType: string,
  quantity: number,
  unitCost: number,
  unitCostSource: string | null,
  priceMap: SupplierPriceMap
) {
  const costFn = (outerQty: number) => {
    const requestedQty = quantity * outerQty;
    return (
      resolveBuyUnitCost(
        { itemId, unitCost, unitCostSource },
        requestedQty,
        priceMap
      ) * requestedQty
    );
  };
  const key =
    itemType === "Material"
      ? "materialCost"
      : itemType === "Part"
        ? "partCost"
        : itemType === "Tool"
          ? "toolCost"
          : itemType === "Consumable"
            ? "consumableCost"
            : itemType === "Service"
              ? "serviceCost"
              : null;
  if (key) effects[key].push(costFn);
}

function buildCostEffects(args: {
  methodType: string;
  lineItemId: string;
  lineUnitCost: number;
  tree: QuoteMethodRow[];
  operations: QuoteOperationRow[];
  priceMap: SupplierPriceMap;
}): CostEffects {
  const effects = emptyEffects();
  const opsByMethod = new Map<string, QuoteOperationRow[]>();
  for (const op of args.operations) {
    const key = op.quoteMakeMethodId ?? "";
    const list = opsByMethod.get(key) ?? [];
    list.push(op);
    opsByMethod.set(key, list);
  }

  type Node = QuoteMethodRow & { children: Node[]; scaledQty: number };
  const lookup = new Map<string, Node>();
  const roots: Node[] = [];

  for (const row of args.tree) {
    lookup.set(row.methodMaterialId, {
      ...row,
      scaledQty: row.quantity,
      children: []
    });
  }
  for (const node of lookup.values()) {
    if (node.parentMaterialId && lookup.has(node.parentMaterialId)) {
      lookup.get(node.parentMaterialId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function scaleTree(node: Node, parentQty: number) {
    node.scaledQty = node.quantity * parentQty;
    for (const child of node.children) scaleTree(child, node.scaledQty);
  }

  function walk(node: Node) {
    const data = node;
    const qty = data.scaledQty;

    if (data.methodType === "Purchase to Order") {
      pushBuyCostEffect(
        effects,
        data.itemId,
        data.itemType,
        qty,
        data.unitCost,
        data.unitCostSource,
        args.priceMap
      );
    } else if (data.methodType === "Pull from Inventory") {
      const costFn = (outerQty: number) => data.unitCost * qty * outerQty;
      const key =
        data.itemType === "Material"
          ? "materialCost"
          : data.itemType === "Part"
            ? "partCost"
            : data.itemType === "Tool"
              ? "toolCost"
              : data.itemType === "Consumable"
                ? "consumableCost"
                : data.itemType === "Service"
                  ? "serviceCost"
                  : null;
      if (key) effects[key].push(costFn);
    }

    const nodeOps = opsByMethod.get(data.quoteMaterialMakeMethodId) ?? [];

    for (const operation of nodeOps) {
      if (operation.operationType === "Outside Processing") {
        effects.outsideCost.push((outerQty) => {
          const cost = operation.operationUnitCost * qty * outerQty;
          return Math.max(operation.operationMinimumCost, cost);
        });
      } else {
        if (operation.setupTime) {
          const { fixedHours, hoursPerUnit } = normalizeTime(
            operation.setupTime,
            operation.setupUnit
          );
          effects.setupHours.push(
            (outerQty) => hoursPerUnit * outerQty * qty + fixedHours
          );
          effects.laborCost.push(
            (outerQty) =>
              hoursPerUnit * outerQty * qty * (operation.laborRate ?? 0) +
              fixedHours * (operation.laborRate ?? 0)
          );
          effects.overheadCost.push(
            (outerQty) =>
              hoursPerUnit * outerQty * qty * (operation.overheadRate ?? 0) +
              fixedHours * (operation.overheadRate ?? 0)
          );
        }

        let laborFixedHours = 0;
        let laborHoursPerUnit = 0;
        let machineFixedHours = 0;
        let machineHoursPerUnit = 0;

        if (operation.laborTime) {
          const n = normalizeTime(operation.laborTime, operation.laborUnit);
          laborFixedHours = n.fixedHours;
          laborHoursPerUnit = n.hoursPerUnit;
          effects.laborHours.push(
            (outerQty) => laborHoursPerUnit * outerQty * qty + laborFixedHours
          );
          effects.laborCost.push(
            (outerQty) =>
              laborHoursPerUnit * outerQty * qty * (operation.laborRate ?? 0) +
              laborFixedHours * (operation.laborRate ?? 0)
          );
        }

        if (operation.machineTime) {
          const n = normalizeTime(operation.machineTime, operation.machineUnit);
          machineFixedHours = n.fixedHours;
          machineHoursPerUnit = n.hoursPerUnit;
          effects.machineHours.push(
            (outerQty) =>
              machineHoursPerUnit * outerQty * qty + machineFixedHours
          );
          effects.machineCost.push(
            (outerQty) =>
              machineHoursPerUnit *
                outerQty *
                qty *
                (operation.machineRate ?? 0) +
              machineFixedHours * (operation.machineRate ?? 0)
          );
        }

        const hpu = Math.max(laborHoursPerUnit, machineHoursPerUnit);
        const fh = Math.max(laborFixedHours, machineFixedHours);
        effects.overheadCost.push((outerQty) => {
          if (hpu * outerQty * qty > fh) {
            return hpu * outerQty * qty * (operation.overheadRate ?? 0);
          }
          return fh * (operation.overheadRate ?? 0);
        });
      }
    }

    for (const child of node.children) walk(child);
  }

  if (args.methodType === "Make to Order") {
    for (const root of roots) {
      scaleTree(root, 1);
      walk(root);
    }
  } else if (args.methodType === "Purchase to Order") {
    pushBuyCostEffect(
      effects,
      args.lineItemId,
      "Material",
      1,
      args.lineUnitCost,
      null,
      args.priceMap
    );
  } else {
    effects.materialCost.push((quantity) => args.lineUnitCost * quantity);
  }

  return effects;
}

export function evaluateLineCosts(
  effects: CostEffects,
  quantity: number
): LineCosts {
  const sum = (fns: CostEffect[]) =>
    fns.reduce((acc, fn) => acc + fn(quantity), 0);
  return {
    consumableCost: sum(effects.consumableCost),
    laborCost: sum(effects.laborCost),
    laborHours: sum(effects.laborHours),
    machineCost: sum(effects.machineCost),
    machineHours: sum(effects.machineHours),
    materialCost: sum(effects.materialCost),
    outsideCost: sum(effects.outsideCost),
    overheadCost: sum(effects.overheadCost),
    partCost: sum(effects.partCost),
    serviceCost: sum(effects.serviceCost),
    setupHours: sum(effects.setupHours),
    toolCost: sum(effects.toolCost)
  };
}

export function totalUnitCost(costs: LineCosts, quantity: number): number {
  const total =
    costs.materialCost +
    costs.partCost +
    costs.toolCost +
    costs.consumableCost +
    costs.serviceCost +
    costs.laborCost +
    costs.machineCost +
    costs.overheadCost +
    costs.outsideCost;
  return quantity > 0 ? total / quantity : 0;
}

export async function loadQuoteLineCostEffects(
  db: ReadonlyDb,
  companyId: string,
  quoteLineId: string
): Promise<{
  methodType: string;
  lineItemId: string;
  lineUnitCost: number;
  effects: CostEffects;
} | null> {
  const line = await db
    .selectFrom("quoteLine")
    .select(["methodType", "itemId", "companyId"])
    .where("id", "=", quoteLineId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!line) return null;

  const itemCost = await db
    .selectFrom("itemCost")
    .select("unitCost")
    .where("itemId", "=", line.itemId)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const root = await db
    .selectFrom("quoteMakeMethod")
    .select("id")
    .where("quoteLineId", "=", quoteLineId)
    .where("companyId", "=", companyId)
    .where("parentMaterialId", "is", null)
    .executeTakeFirst();

  const operations = await db
    .selectFrom("quoteOperation")
    .selectAll()
    .where("quoteLineId", "=", quoteLineId)
    .where("companyId", "=", companyId)
    .execute();

  if (!root && line.methodType === "Make to Order") return null;

  let tree: QuoteMethodRow[] = [];
  const materialMeta = await db
    .selectFrom("quoteMaterial")
    .select(["id", "unitCostSource"])
    .where("quoteLineId", "=", quoteLineId)
    .where("companyId", "=", companyId)
    .execute();
  const sourceByMaterialId = new Map(
    materialMeta.map((m) => [m.id, m.unitCostSource])
  );

  if (root) {
    const { rows } = await sql<QuoteMethodRow & { methodMaterialId: string }>`
      SELECT * FROM get_quote_methods_by_method_id(${root.id}::text)
    `.execute(db);
    tree = (rows ?? []).map((r) => ({
      methodMaterialId: r.methodMaterialId,
      parentMaterialId: r.parentMaterialId,
      quoteMaterialMakeMethodId: r.quoteMaterialMakeMethodId,
      itemId: r.itemId,
      itemType: r.itemType,
      methodType: r.methodType,
      quantity: Number(r.quantity),
      unitCost: Number(r.unitCost ?? 0),
      unitCostSource: sourceByMaterialId.get(r.methodMaterialId) ?? null
    }));
  }

  const itemIds = [
    ...new Set([
      line.itemId,
      ...tree.map((t) => t.itemId),
      ...(
        await db
          .selectFrom("quoteMaterial")
          .select("itemId")
          .where("quoteLineId", "=", quoteLineId)
          .where("companyId", "=", companyId)
          .execute()
      ).map((m) => m.itemId)
    ])
  ];
  const priceMap = await loadSupplierPriceMap(db, companyId, itemIds);

  const effects = buildCostEffects({
    methodType: line.methodType,
    lineItemId: line.itemId,
    lineUnitCost: Number(itemCost?.unitCost ?? 0),
    tree,
    operations: operations.map((op) => ({
      quoteMakeMethodId: op.quoteMakeMethodId ?? null,
      operationType: op.operationType,
      setupTime: Number(op.setupTime ?? 0),
      setupUnit: op.setupUnit ?? "Total Hours",
      laborTime: Number(op.laborTime ?? 0),
      laborUnit: op.laborUnit ?? "Total Hours",
      laborRate: Number(op.laborRate ?? 0),
      machineTime: Number(op.machineTime ?? 0),
      machineUnit: op.machineUnit ?? "Total Hours",
      machineRate: op.machineRate != null ? Number(op.machineRate) : null,
      overheadRate: Number(op.overheadRate ?? 0),
      operationUnitCost: Number(op.operationUnitCost ?? 0),
      operationMinimumCost: Number(op.operationMinimumCost ?? 0)
    })),
    priceMap
  });

  return {
    methodType: line.methodType,
    lineItemId: line.itemId,
    lineUnitCost: Number(itemCost?.unitCost ?? 0),
    effects
  };
}

export async function computeLineCostsAtQuantity(
  db: ReadonlyDb,
  companyId: string,
  quoteLineId: string,
  quantity: number
): Promise<LineCosts | null> {
  const loaded = await loadQuoteLineCostEffects(db, companyId, quoteLineId);
  if (!loaded) return null;
  return evaluateLineCosts(loaded.effects, quantity);
}
