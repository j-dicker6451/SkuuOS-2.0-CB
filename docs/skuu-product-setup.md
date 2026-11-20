# SkuuOS product setup (UI)

Plain-language flows for bulk formulation, finished goods, and batch tickets. No customer formulas are committed; use a gitignored `*.local.json` with the spike input shape.

## Routes (Mac)

| Screen | Path |
|--------|------|
| New product wizard | `/x/skuu/new-product?step=1` |
| Bulk — Formulation & method | `/x/part/{bulkItemId}/formulation` |
| Finished good — Product build | `/x/part/{fgItemId}/product-build` |
| Bulk batch ticket (print) | `/x/job/{jobId}/bulk-batch-ticket` |

Part tabs **Formulation & method** (Make, kg) and **Product build** (Make, EA) appear on the part header.

## Seed full product (BLD BRO etc.)

1. Copy spike example shape to `apps/erp/scripts/skuu-spike/bld-bro-night.local.json` (gitignored).
2. Add `partCode` per ingredient (Cosmetri 1A codes) and optional `phases[]` with `instructions`.
3. Run:

```bash
pnpm db:migrate
pnpm dev   # PostgREST required
export SKUU_PRODUCT_INPUT=apps/erp/scripts/skuu-spike/bld-bro-night.local.json
# Optional: export SKUU_SPIKE_PREFIX=skuu-product-bldbro
pnpm skuu:product-seed
```

Runs through Vitest (`vitest.product-seed.config.ts`) like `pnpm skuu:spike` — not `tsx` — so `@carbon/lib` resolves correctly. **Does not tear down**; jobs/parts stay in the DB for click-through. Re-run with a new `SKUU_SPIKE_PREFIX` if tagged rows already exist.

Same harness as spike (raw Materials shared by code, bulk/fill Parts, jobs, trace). Report: `apps/erp/scripts/skuu-spike/report-product-seed.txt`.

## Migrations

No new migrations in this PR — uses existing `skuu*` tables from the fit-gap branch.

## Batch ticket

Matches `docs/skuu-formula-batch-design.md`: header, phases, dispensing list (kg/g/% to 4 dp), blank QC/sign-off boxes. Digital QC entry is out of scope.