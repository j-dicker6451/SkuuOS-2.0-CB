// SPDX-License-Identifier: AGPL-3.0-only

import { lineKgFromPercent, manufactureFromExpectedYield } from "@skuu/formula";
import {
  clampPagination,
  collapseTraceByReadableId,
  computeLineCostsAtQuantity,
  costCategoryKeys,
  evaluateLineCosts,
  formatTraceNodeLabel,
  loadQuoteLineCostEffects,
  type ReadonlyDb,
  totalUnitCost,
  traceActivityLineage
} from "@skuu/readonly";
import { sql } from "kysely";

export async function searchItems(
  db: ReadonlyDb,
  args: {
    companyId: string;
    query?: string;
    type?: "Material" | "Part" | "Consumable";
    tag?: "Bulk" | "Packaging" | "Finished Good";
    limit?: number;
    offset?: number;
  }
) {
  const { limit, offset } = clampPagination(args);
  let qb = db
    .selectFrom("item")
    .select([
      "item.id",
      "item.readableId",
      "item.name",
      "item.type",
      "item.replenishmentSystem",
      "item.itemTrackingType",
      "item.unitOfMeasureCode"
    ])
    .where("item.companyId", "=", args.companyId);

  if (args.type) qb = qb.where("item.type", "=", args.type);
  if (args.query) {
    const q = `%${args.query}%`;
    qb = qb.where((eb) =>
      eb.or([eb("item.readableId", "ilike", q), eb("item.name", "ilike", q)])
    );
  }

  if (args.tag && args.type === "Part") {
    qb = qb
      .innerJoin("part", "part.id", "item.id")
      .where("part.companyId", "=", args.companyId)
      .where(sql<boolean>`part.tags @> ARRAY[${args.tag}]::text[]`);
  } else if (args.tag && args.type === "Material") {
    qb = qb
      .innerJoin("material", "material.id", "item.id")
      .where("material.companyId", "=", args.companyId)
      .where(sql<boolean>`material.tags @> ARRAY[${args.tag}]::text[]`);
  }

  const rows = await qb
    .orderBy("item.readableId")
    .limit(limit)
    .offset(offset)
    .execute();
  return { items: rows, limit, offset };
}

export async function getItem(
  db: ReadonlyDb,
  companyId: string,
  itemId: string
) {
  const item = await db
    .selectFrom("item")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("id", "=", itemId)
    .executeTakeFirst();
  if (!item) return null;

  const cost = await db
    .selectFrom("itemCost")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("itemId", "=", itemId)
    .executeTakeFirst();

  let tags: string[] | null = null;
  if (item.type === "Material") {
    tags =
      (
        await db
          .selectFrom("material")
          .select("tags")
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      )?.tags ?? null;
  } else if (item.type === "Part") {
    tags =
      (
        await db
          .selectFrom("part")
          .select("tags")
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      )?.tags ?? null;
  } else if (item.type === "Consumable") {
    tags =
      (
        await db
          .selectFrom("consumable")
          .select("tags")
          .where("id", "=", itemId)
          .where("companyId", "=", companyId)
          .executeTakeFirst()
      )?.tags ?? null;
  }

  return { item, cost, tags };
}

export async function getBulkFormula(
  db: ReadonlyDb,
  companyId: string,
  opts: { itemId?: string; formulaRef?: string; batchKg?: number }
) {
  let itemId = opts.itemId;
  if (!itemId && opts.formulaRef) {
    const row = await db
      .selectFrom("item")
      .select("id")
      .where("companyId", "=", companyId)
      .where("readableId", "=", opts.formulaRef)
      .executeTakeFirst();
    itemId = row?.id;
  }
  if (!itemId) return null;

  const makeMethod = await db
    .selectFrom("makeMethod")
    .select("id")
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Active")
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!makeMethod) return { itemId, lines: [], profile: null };

  const profile = await db
    .selectFrom("skuuMakeMethodBulk")
    .selectAll()
    .where("makeMethodId", "=", makeMethod.id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();

  const lines = await db
    .selectFrom("methodMaterial as mm")
    .innerJoin("skuuMethodMaterialFormula as f", "f.methodMaterialId", "mm.id")
    .innerJoin("item as i", "i.id", "mm.itemId")
    .select([
      "i.readableId as ingredientSku",
      "i.name as ingredientName",
      "f.percentWw",
      "mm.quantity as methodQty"
    ])
    .where("mm.makeMethodId", "=", makeMethod.id)
    .where("mm.companyId", "=", companyId)
    .execute();

  const batchKg = opts.batchKg ?? Number(profile?.batchBasisKg ?? 100);
  const yieldPct = profile?.enabled
    ? 100 - Number(profile.yieldLossPercent ?? 0)
    : 100;
  const grossKg = manufactureFromExpectedYield(batchKg, yieldPct);

  return {
    itemId,
    makeMethodId: makeMethod.id,
    profile,
    batchKg,
    expectedYieldPercent: yieldPct,
    grossBatchKg: grossKg,
    lines: lines.map((l) => ({
      ingredientSku: l.ingredientSku,
      ingredientName: l.ingredientName,
      percentWw: Number(l.percentWw ?? 0),
      netKgAtBatch: lineKgFromPercent(Number(l.percentWw ?? 0), batchKg),
      grossKgAtBatch: lineKgFromPercent(Number(l.percentWw ?? 0), grossKg)
    }))
  };
}

export async function getBom(
  db: ReadonlyDb,
  companyId: string,
  itemId: string
) {
  const root = await db
    .selectFrom("makeMethod")
    .select("id")
    .where("itemId", "=", itemId)
    .where("companyId", "=", companyId)
    .where("status", "=", "Active")
    .orderBy("version", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!root) return null;

  const materials = await db
    .selectFrom("methodMaterial")
    .innerJoin("item", "item.id", "methodMaterial.itemId")
    .select([
      "methodMaterial.quantity",
      "methodMaterial.itemType",
      "methodMaterial.methodType",
      "item.readableId",
      "item.name",
      "item.unitOfMeasureCode"
    ])
    .where("makeMethodId", "=", root.id)
    .where("methodMaterial.companyId", "=", companyId)
    .execute();

  return { finishedItemId: itemId, makeMethodId: root.id, lines: materials };
}

export async function getInventory(
  db: ReadonlyDb,
  companyId: string,
  itemId: string,
  limit?: number,
  offset?: number
) {
  const page = clampPagination({ limit, offset });
  const lots = await db
    .selectFrom("trackedEntity as te")
    .select([
      "te.id",
      "te.readableId",
      "te.quantity",
      "te.status",
      "te.expirationDate",
      "te.retestDate"
    ])
    .where("te.companyId", "=", companyId)
    .where("te.itemId", "=", itemId)
    .orderBy("te.readableId")
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { lots, ...page };
}

export async function traceLot(
  db: ReadonlyDb,
  companyId: string,
  trackedEntityId: string,
  direction: "forward" | "back"
) {
  const nodes = await traceActivityLineage(
    db,
    companyId,
    trackedEntityId,
    direction
  );
  const collapsed = collapseTraceByReadableId(nodes);
  return {
    direction,
    trackedEntityId,
    nodes: collapsed.map((n) => ({
      ...n,
      label: formatTraceNodeLabel(n)
    }))
  };
}

export async function listJobs(
  db: ReadonlyDb,
  companyId: string,
  limit?: number,
  offset?: number,
  status?: string
) {
  const page = clampPagination({ limit, offset });
  let qb = db
    .selectFrom("job")
    .select([
      "id",
      "jobId",
      "status",
      "quantity",
      "quantityComplete",
      "itemId",
      "quoteId",
      "quoteLineId"
    ])
    .where("companyId", "=", companyId);
  if (status) qb = qb.where("status", "=", status as never);
  const jobs = await qb
    .orderBy("createdAt", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { jobs, ...page };
}

export async function getJob(db: ReadonlyDb, companyId: string, jobId: string) {
  const job = await db
    .selectFrom("job")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("id", "=", jobId)
    .executeTakeFirst();
  if (!job) return null;

  const materials = await db
    .selectFrom("jobMaterial")
    .innerJoin("item", "item.id", "jobMaterial.itemId")
    .select([
      "jobMaterial.id",
      "item.readableId",
      "jobMaterial.quantity",
      "jobMaterial.estimatedQuantity",
      "jobMaterial.quantityIssued",
      "jobMaterial.unitCost"
    ])
    .where("jobMaterial.jobId", "=", jobId)
    .where("jobMaterial.companyId", "=", companyId)
    .execute();

  return { job, materials };
}

export async function listOpenPurchaseOrders(
  db: ReadonlyDb,
  companyId: string,
  limit?: number,
  offset?: number
) {
  const page = clampPagination({ limit, offset });
  const orders = await db
    .selectFrom("purchaseOrder")
    .select(["id", "purchaseOrderId", "status", "orderDate", "supplierId"])
    .where("companyId", "=", companyId)
    .where("status", "not in", ["Closed", "Completed", "Rejected"])
    .orderBy("orderDate", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { orders, ...page };
}

export async function listSalesOrders(
  db: ReadonlyDb,
  companyId: string,
  limit?: number,
  offset?: number
) {
  const page = clampPagination({ limit, offset });
  const orders = await db
    .selectFrom("salesOrder")
    .select(["id", "salesOrderId", "status", "orderDate", "customerId"])
    .where("companyId", "=", companyId)
    .where("status", "not in", ["Closed", "Cancelled", "Completed", "Invoiced"])
    .orderBy("orderDate", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { orders, ...page };
}

export async function listQuotes(
  db: ReadonlyDb,
  companyId: string,
  limit?: number,
  offset?: number
) {
  const page = clampPagination({ limit, offset });
  const quotes = await db
    .selectFrom("quote")
    .select([
      "id",
      "quoteId",
      "status",
      "customerId",
      "expirationDate",
      "dueDate"
    ])
    .where("companyId", "=", companyId)
    .orderBy("createdAt", "desc")
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { quotes, ...page };
}

export async function getQuote(
  db: ReadonlyDb,
  companyId: string,
  quoteId: string
) {
  const quote = await db
    .selectFrom("quote")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("id", "=", quoteId)
    .executeTakeFirst();
  if (!quote) return null;

  const lines = await db
    .selectFrom("quoteLine")
    .selectAll()
    .where("quoteId", "=", quoteId)
    .where("companyId", "=", companyId)
    .orderBy("sortOrder")
    .execute();

  const linePayloads = [];
  for (const line of lines) {
    const quantities = (line.quantity ?? []).map(Number);
    const prices = await db
      .selectFrom("quoteLinePrice")
      .selectAll()
      .where("quoteLineId", "=", line.id)
      .where("companyId", "=", companyId)
      .execute();

    const costCtx = await loadQuoteLineCostEffects(db, companyId, line.id);
    const breaks = [];
    for (const qty of quantities) {
      const priceRow =
        prices.find((p) => Number(p.quantity) === qty) ??
        prices.find((p) => Math.abs(Number(p.quantity) - qty) < 1e-6);
      const costs = costCtx ? evaluateLineCosts(costCtx.effects, qty) : null;
      const unitCost = costs ? totalUnitCost(costs, qty) : null;
      const unitPrice = priceRow ? Number(priceRow.unitPrice) : null;
      const discount = priceRow ? Number(priceRow.discountPercent) : 0;
      const netUnit = unitPrice != null ? unitPrice * (1 - discount) : null;
      const profitPct =
        netUnit != null && unitCost != null && netUnit > 0
          ? ((netUnit - unitCost) / netUnit) * 100
          : null;

      const categoryUnit: Record<string, number> = {};
      if (costs) {
        for (const key of costCategoryKeys) {
          const total = costs[key];
          categoryUnit[key] = qty > 0 ? total / qty : 0;
        }
      }

      breaks.push({
        quantity: qty,
        unitCost,
        unitCostBreakdown: categoryUnit,
        totalUnitCost:
          costs &&
          costs.materialCost +
            costs.partCost +
            costs.laborCost +
            costs.machineCost +
            costs.outsideCost +
            costs.overheadCost +
            costs.consumableCost +
            costs.serviceCost +
            costs.toolCost,
        unitPrice,
        discountPercent: discount,
        netUnitPrice: netUnit,
        leadTime: priceRow ? Number(priceRow.leadTime) : null,
        profitPercent: profitPct,
        categoryMarkups: priceRow?.categoryMarkups ?? null
      });
    }

    linePayloads.push({
      line,
      quantityBreaks: quantities,
      priceBreaks: breaks
    });
  }

  return { quote, lines: linePayloads };
}

export async function getItemCost(
  db: ReadonlyDb,
  companyId: string,
  itemId: string
) {
  const item = await getItem(db, companyId, itemId);
  if (!item) return null;

  const lots = await db
    .selectFrom("trackedEntity as te")
    .innerJoin("itemLedger as il", (join) =>
      join
        .onRef("il.trackedEntityId", "=", "te.id")
        .on("il.companyId", "=", companyId)
        .on("il.entryType", "=", "Positive Adjmt.")
    )
    .leftJoin("receiptLine as rl", (join) =>
      join
        .onRef("rl.id", "=", "il.documentLineId")
        .on("rl.companyId", "=", companyId)
    )
    .select([
      "te.id as lotId",
      "te.readableId as lotNumber",
      "te.quantity",
      "rl.unitPrice as receivedUnitCost",
      "il.postingDate",
      "il.documentId as receiptId"
    ])
    .where("te.companyId", "=", companyId)
    .where("te.itemId", "=", itemId)
    .where("il.documentType", "=", "Purchase Receipt")
    .distinctOn("te.id")
    .orderBy("te.id")
    .orderBy("il.postingDate", "desc")
    .limit(100)
    .execute();

  return {
    itemId,
    currentUnitCost: item.cost?.unitCost ?? null,
    costingMethod: item.cost?.costingMethod ?? null,
    standardCost: item.cost?.standardCost ?? null,
    lots: lots.map((l) => ({
      lotId: l.lotId,
      lotNumber: l.lotNumber,
      quantity: Number(l.quantity),
      receivedUnitCost:
        l.receivedUnitCost != null ? Number(l.receivedUnitCost) : null,
      receiptId: l.receiptId,
      postingDate: l.postingDate
    }))
  };
}

export async function getJobCostVsQuote(
  db: ReadonlyDb,
  companyId: string,
  jobId: string
) {
  const job = await db
    .selectFrom("job")
    .selectAll()
    .where("companyId", "=", companyId)
    .where("id", "=", jobId)
    .executeTakeFirst();
  if (!job) return null;

  const qty = Number(job.quantity);
  const quoteLineId = job.quoteLineId;
  let quoted: {
    unitPrice: number | null;
    unitCost: number | null;
    profitPercent: number | null;
  } | null = null;

  if (quoteLineId) {
    const costs = await computeLineCostsAtQuantity(
      db,
      companyId,
      quoteLineId,
      qty
    );
    const price = await db
      .selectFrom("quoteLinePrice")
      .select(["unitPrice", "discountPercent"])
      .where("quoteLineId", "=", quoteLineId)
      .where("companyId", "=", companyId)
      .where("quantity", "=", qty)
      .executeTakeFirst();
    const unitCost = costs ? totalUnitCost(costs, qty) : null;
    const unitPrice = price ? Number(price.unitPrice) : null;
    const net =
      unitPrice != null
        ? unitPrice * (1 - Number(price?.discountPercent ?? 0))
        : null;
    quoted = {
      unitPrice: net,
      unitCost,
      profitPercent:
        net != null && unitCost != null && net > 0
          ? ((net - unitCost) / net) * 100
          : null
    };
  }

  const materials = await db
    .selectFrom("jobMaterial as jm")
    .innerJoin("item", "item.id", "jm.itemId")
    .leftJoin("itemCost as ic", (join) =>
      join
        .onRef("ic.itemId", "=", "jm.itemId")
        .on("ic.companyId", "=", companyId)
    )
    .select([
      "jm.id",
      "jm.itemId",
      "item.readableId",
      "jm.quantity",
      "jm.estimatedQuantity",
      "jm.quantityIssued",
      "jm.unitCost as jobMaterialUnitCost",
      "ic.unitCost as itemCostFallback"
    ])
    .where("jm.jobId", "=", jobId)
    .where("jm.companyId", "=", companyId)
    .execute();

  let lotCostUsed = false;
  const materialRows = [];
  for (const m of materials) {
    const issued = Number(m.quantityIssued ?? 0);
    const est = Number(m.estimatedQuantity ?? m.quantity);
    let actualUnit = Number(m.jobMaterialUnitCost ?? 0);
    let basis: "jobMaterialUnitCost" | "itemCost" | "lotReceipt" =
      "jobMaterialUnitCost";

    if (m.jobMaterialUnitCost == null || m.jobMaterialUnitCost === 0) {
      actualUnit = Number(m.itemCostFallback ?? 0);
      basis = "itemCost";
    }

    if (issued > 0) {
      const lotCost = await db
        .selectFrom("trackedActivityInput as tai")
        .innerJoin("trackedActivity as ta", "ta.id", "tai.trackedActivityId")
        .innerJoin("trackedEntity as te", "te.id", "tai.trackedEntityId")
        .innerJoin("itemLedger as il", (join) =>
          join
            .onRef("il.trackedEntityId", "=", "te.id")
            .on("il.companyId", "=", companyId)
            .on("il.documentType", "=", "Purchase Receipt")
        )
        .leftJoin("receiptLine as rl", "rl.id", "il.documentLineId")
        .select((eb) => eb.fn.avg<number>("rl.unitPrice").as("avgLotCost"))
        .where("ta.companyId", "=", companyId)
        .where(sql`ta.attributes->>'Job'`, "=", jobId)
        .where("te.itemId", "=", m.itemId)
        .executeTakeFirst();
      const avg = lotCost?.avgLotCost;
      if (avg != null && Number(avg) > 0) {
        actualUnit = Number(avg);
        basis = "lotReceipt";
        lotCostUsed = true;
      }
    }

    materialRows.push({
      itemSku: m.readableId,
      estimatedQty: est,
      issuedQty: issued,
      estimatedCost:
        est * Number(m.jobMaterialUnitCost ?? m.itemCostFallback ?? 0),
      actualCost: issued * actualUnit,
      unitCostBasis: basis,
      actualUnitCost: actualUnit
    });
  }

  const actualMaterial = materialRows.reduce((s, r) => s + r.actualCost, 0);
  const estimatedMaterial = materialRows.reduce(
    (s, r) => s + r.estimatedCost,
    0
  );

  return {
    jobId,
    quoteLineId: job.quoteLineId,
    quoteId: job.quoteId,
    quantity: qty,
    valuationNote:
      "Actual materials use average received lot unit cost from purchase receipts when genealogy ties lots to this job; otherwise job material unit cost, then itemCost.",
    lotCostUsed,
    quoted,
    materials: materialRows,
    totals: {
      estimatedMaterialCost: estimatedMaterial,
      actualMaterialCost: actualMaterial,
      materialVariance: actualMaterial - estimatedMaterial
    }
  };
}
