# SkuuOS formula spike

End-to-end: raw lots → bulk % job → two fill jobs → shipment → trace.

```bash
# From repo root (loads .env then .env.local automatically):
pnpm skuu:spike
pnpm skuu:product-seed   # uses fixtures/demo-serum.json (synthetic, no customer data)
```

Requires migrations, seed (`test@carbon.ms` by default), and `pnpm dev` / `crbn up` for PostgREST.

**Committed fixture:** `fixtures/demo-serum.json` — 6 phases, duplicate water line, 100 kg batch, one 15 ml fill. Override with `SKUU_PRODUCT_INPUT` / `SKUU_SPIKE_INPUT`.

UoM and currency codes are read from the seeded company (`kg`, `EA`, `company.baseCurrencyCode`) — not hardcoded.

### Item types (Cosmetri mapping)

| Role | Type | Replenishment | Tracking | UoM | Create path |
| --- | --- | --- | --- | --- | --- |
| Raw ingredient | **Material** | Buy | Batch | kg | `upsertMaterial` (New Material — `item` + `material` + cost/replenishment). If **generated material IDs** are on, spike ensures substance **Cosmetic raw material** (`COSRAW`) and shape **Bulk** (`BULK`), then retargets the item to your `partCode` (1A…). Manual-ID companies pass `id` only, like the Material form. |
| Bulk | Part | Make | Batch | kg | `upsertPart` — readableId `BULK-{formulaRef}` |
| Finished SKU | Part | Make | Batch | EA | `upsertPart` — readableId `FG-{formulaRef}-{packMl}ML` |
| Packaging | Part | Buy | Batch | (sku) | not in this spike |

Product/spike runs set **`companySettings.materialGeneratedIds = false`**, backfill **`item.name`/`description`** to trade names, and **clear substance+shape** links on formula raws (no new Cosmetic raw / Bulk shape rows). Shared raw materials use real **`partCode`** values from input (Cosmetri codes on Mac `*.local.json`); demo fixture uses `RM-*-DEMO` codes. One material SKU per `partCode`, reused across formulas. **BULK-/FG-** parts, **process** rows (by name), and method BOM lines are also reused across prefixes (`skuu-spike` vs `skuu-product`). Lots and jobs are tagged with the run **`prefix`** (`{SKUU_SPIKE_PREFIX}-{formulaRef}`); teardown does **not** delete shared materials or cross-prefix bulk/fill SKUs. Re-running product seed **reuses** jobs when `job.jobId` already exists (or allocates `{id}-0002` … if the base id is taken).

Never raw `item` inserts — `app.sync_in_progress` on Kysely seed transactions skips item interceptors and breaks receipts.

Teardown deletes tagged jobs/lots/SO/shipment rows by **`readableId` prefix**, plus bulk/fill **parts** tied to those jobs (not shared raw **materials**). MES rows (`trackedActivity`, `itemLedger`, …) and Skuu rows follow the same tag. Uses `session_replication_role = replica` like test fixture resets.

### Material vs Part in Carbon

- **Materials** have no active make method by default; spike BOM lines use `itemType: "Material"` on `methodMaterial` / `jobMaterial`.
- Receipt, MES batch issue (`trackedEntitiesToOperation`), gross-up (`recalculateJobRequirements`), and trace behave the same as for buy **Parts** in this flow.
- **Parts** (`upsertPart`) get an auto **Draft** make method; spike promotes it to **Active** for bulk/fill SKUs.

| Step | ERP mirror |
| --- | --- |
| Receive raw | `postInventoryAdjustment` (manual positive adj.) |
| Bulk/fill jobs | `insertJob` → `recalculateJobRequirements` (Skuu gross-up) → release → **MES** `trackedEntitiesToOperation` + `jobOperationBatchComplete` → `complete_job_to_inventory` |
| Ship | `createDocument` + `postShipment` |

- Input: `example-formula.json` or `SKUU_SPIKE_INPUT` / `SKUU_PRODUCT_INPUT` (optional `partCode` per ingredient; optional `phaseNumber` per line; optional `phases[]` instructions; **`fills: []`** = bulk-only — no fill jobs, ship, or trace-to-FG; optional `batchTargetLiters` cross-check vs `batchKg` × density; optional `secondProduct` for cross-bulk lot sharing)
- PostgREST URL: `SUPABASE_URL` or **`SKUU_SPIKE_SUPABASE_URL`** (e.g. `http://[::1]:54321` when Cursor Agents shadows `127.0.0.1:54321`)
- Local-only: `*.local.json` (gitignored)
- Report: `report-last-run.txt` in this folder