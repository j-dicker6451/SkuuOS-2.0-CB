# SkuuOS read-only MCP

Standalone Model Context Protocol server for SkuuOS ERP data. **Read-only**: Postgres role + `SET TRANSACTION READ ONLY` on every query. Not wired to the ERP `api+/mcp+` route or `generate:mcp`.

## Environment

| Variable | Purpose |
|----------|---------|
| `SKUUOS_MCP_DATABASE_URL` | Postgres URL for login granted `skuuos_mcp_readonly` (never log this value) |
| `SKUUOS_MCP_HTTP_HOST` | HTTP bind address (default `127.0.0.1`) |
| `SKUUOS_MCP_HTTP_PORT` | HTTP port (default `3847`) |
| `SKUUOS_MCP_HTTP_TOKEN` | Bearer token required for HTTP transport |

After `db:migrate`, create a login user and:

```sql
CREATE ROLE skuuos_mcp_login LOGIN PASSWORD '…';
GRANT skuuos_mcp_readonly TO skuuos_mcp_login;
```

Example URL (placeholder only): `postgresql://skuuos_mcp_login:********@127.0.0.1:54322/postgres`

## Run (Mac)

```bash
pnpm install
pnpm db:migrate   # applies skuuos_mcp_readonly grants

export SKUUOS_MCP_DATABASE_URL='postgresql://…'
pnpm skuu:mcp            # stdio (Cursor / Claude Desktop)
SKUUOS_MCP_HTTP_TOKEN='…' pnpm skuu:mcp:http   # streamable HTTP on localhost
```

Connect MCP clients to stdio: `pnpm --filter @skuu/mcp exec tsx src/cli.ts --stdio`  
HTTP: `http://127.0.0.1:3847/mcp` with `Authorization: Bearer <token>`.

## Tools (v1)

All tools require `companyId`.

| Tool | Description |
|------|-------------|
| `search_items` | Query + type/tag filters, paginated |
| `get_item` | Item, replenishment, tracking, cost, tags |
| `get_bulk_formula` | % w/w, yield, gross kg via `@skuu/formula` |
| `get_bom` | Finished SKU method materials |
| `get_inventory` | Lots, qty, status, location, expiry/retest |
| `trace_lot` | Forward/reverse genealogy (`@skuu/readonly`) |
| `list_jobs` / `get_job` | Status, materials estimated vs issued |
| `list_open_purchase_orders` / `list_sales_orders` | Open orders |
| `list_quotes` / `get_quote` | Quotes; **`get_quote` returns every `quoteLine.quantity[]` break** with `unitCost`, `unitCostBreakdown`, `unitPrice`, `discountPercent`, `netUnitPrice`, `leadTime`, `profitPercent` (same margin formula as `QuoteLinePricing`) |
| `get_item_cost` | `itemCost` + receipt lot unit prices |
| `get_job_cost_vs_quote` | Job vs linked quote line (lot cost basis noted) |

Default page size 25, max 100.

## Upstream ERP MCP (not used)

Path: `apps/erp/app/routes/api+/mcp+/` — SPDX **AGPL-3.0-only** plus Carbon port notice on TS sources:

- `_index.ts`
- `lib/manifest.ts`, `agent-setup-prompt.ts`, `agent-setup-prompt.md`
- `lib/catalog-search.test.ts`, `describe-format.test.ts`, `format-result.test.ts`, `manifest.test.ts`
- Generated: `lib/tool-manifest.digest.json`, `lib/tool-metadata.json`

That stack depends on `@carbon/ee/mcp` (enterprise). SkuuOS MCP is independent under `packages/skuu-mcp` and `packages/skuu-readonly`.

## Tagging

Skuu merchandising tags use native `part` / `material` `tags` text arrays: **Bulk**, **Packaging**, **Finished Good** (no new schema).

---

## Future PR: cosmetics COGS on quotes (not in this PR)

**Wait for Jasper go.** Price breaks are central: Carbon already stores `quoteLine.quantity` as `numeric[]` with one `quoteLinePrice` row per break; `useLineCosts.tsx` cost functions are **functions of quantity** (fixed setup hours amortised); `supplierPartPrice` quantity tiers, `customerItemPriceOverrideBreak`, and `pricingRule` min/max quantity tie pricing to volume. The cosmetics COGS plan must compute **cost per unit at each break** and expose the same shape on quote UI and MCP quote tools.

Per break (reuse `useLineCosts` / `QuoteLineCosting` / `QuoteLinePricing` — **no parallel engine**):

1. **Raw kg needed** → `units × bulk kg/unit` grossed up for yield (`@skuu/formula`, bulk profile).
2. **Bulk batches** → round up to whole batch sizes from `skuuMakeMethodBulk`; leftover bulk costed or flagged.
3. **Raw purchase cost** → supplier `supplierPartPrice` tier for kg actually bought; respect raw MOQs/pack sizes (decimal MOQs from MOQ PR); flag excess purchase.
4. **Packaging** → supplier tier for the break unit count.
5. **Fill + bulk setup/changeover** → fixed time from quote operations amortised over break qty (same effect functions as `useLineCosts`).
6. **Price** → target margin or markup per break → unit price; UI and MCP should show how unit cost and unit price fall as volume rises.

**Touchpoints:** extend quote line costing payload (category fields on `quoteLinePrice` and/or `priceTrace`), wire grids through existing costing/pricing components. **MCP contract (now and after cosmetics):** `get_quote` must return **every break** with unit cost, unit price, discount, lead time, and margin. Today, unit cost comes from `@skuu/readonly/quote-line-costs.ts` (ported `useLineCosts`); the cosmetics PR swaps in Skuu bulk/fill/MOQ logic while keeping the same per-break response shape.

**Spike:** synthetic formula first; then BLD BRO NIGHT local input on a follow-up branch off the merged MCP branch.