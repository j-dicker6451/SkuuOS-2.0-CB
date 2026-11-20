// SPDX-License-Identifier: AGPL-3.0-only

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getMcpContext } from "./context";
import * as q from "./queries";
import {
  companyIdSchema,
  itemTypeFilter,
  paginationInput,
  skuuTagFilter
} from "./schemas";

export function registerSkuuTools(server: McpServer) {
  const ctx = getMcpContext();

  const withDb = async <T>(
    fn: (db: Parameters<typeof q.searchItems>[0]) => Promise<T>
  ) => ctx.query(fn);

  server.tool(
    "search_items",
    "Search items in a company by readable id or name; optional type and Skuu tag (Bulk, Packaging, Finished Good on part/material tags).",
    {
      companyId: companyIdSchema,
      query: z.string().optional(),
      type: itemTypeFilter,
      tag: skuuTagFilter,
      ...paginationInput
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.searchItems(db, args)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_item",
    "Get one item with replenishment, tracking, UoM, itemCost, and extension tags.",
    { companyId: companyIdSchema, itemId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.getItem(db, args.companyId, args.itemId)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_bulk_formula",
    "Skuu bulk % w/w formula for a bulk item id or readable formula ref, with net and gross kg per batch.",
    {
      companyId: companyIdSchema,
      itemId: z.string().optional(),
      formulaRef: z.string().optional(),
      batchKg: z.number().positive().optional()
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.getBulkFormula(db, args.companyId, args)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_bom",
    "Active make method BOM lines for a finished SKU (bulk kg per unit and packaging pulls).",
    { companyId: companyIdSchema, itemId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.getBom(db, args.companyId, args.itemId)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_inventory",
    "Batch lots for an item: quantity, status, location, expiry and retest date.",
    {
      companyId: companyIdSchema,
      itemId: z.string().min(1),
      ...paginationInput
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.getInventory(
                db,
                args.companyId,
                args.itemId,
                args.limit,
                args.offset
              )
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "trace_lot",
    "Forward or reverse genealogy from a tracked entity (lot) id.",
    {
      companyId: companyIdSchema,
      trackedEntityId: z.string().min(1),
      direction: z.enum(["forward", "back"]).default("forward")
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.traceLot(
                db,
                args.companyId,
                args.trackedEntityId,
                args.direction
              )
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "list_jobs",
    "List production jobs for a company.",
    {
      companyId: companyIdSchema,
      status: z.string().optional(),
      ...paginationInput
    },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.listJobs(
                db,
                args.companyId,
                args.limit,
                args.offset,
                args.status
              )
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_job",
    "Job detail with materials (estimated vs issued quantities and unit costs).",
    { companyId: companyIdSchema, jobId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.getJob(db, args.companyId, args.jobId)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "list_open_purchase_orders",
    "Open purchase orders with status and supplier.",
    { companyId: companyIdSchema, ...paginationInput },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.listOpenPurchaseOrders(
                db,
                args.companyId,
                args.limit,
                args.offset
              )
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "list_sales_orders",
    "Open sales orders with status and customer.",
    { companyId: companyIdSchema, ...paginationInput },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.listSalesOrders(db, args.companyId, args.limit, args.offset)
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "list_quotes",
    "Quotes for a company (status, customer, dates).",
    { companyId: companyIdSchema, ...paginationInput },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.listQuotes(db, args.companyId, args.limit, args.offset)
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_quote",
    "Quote header, lines, and every quantity break with unit cost rollup (useLineCosts logic), unit price, discount, lead time, profit %.",
    { companyId: companyIdSchema, quoteId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) => q.getQuote(db, args.companyId, args.quoteId)),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_item_cost",
    "Current itemCost row and received lot costs from purchase receipts.",
    { companyId: companyIdSchema, itemId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.getItemCost(db, args.companyId, args.itemId)
            ),
            null,
            2
          )
        }
      ]
    })
  );

  server.tool(
    "get_job_cost_vs_quote",
    "Compare job actual material cost to quoted cost/price for the linked quote line qty.",
    { companyId: companyIdSchema, jobId: z.string().min(1) },
    async (args) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            await withDb((db) =>
              q.getJobCostVsQuote(db, args.companyId, args.jobId)
            ),
            null,
            2
          )
        }
      ]
    })
  );
}
