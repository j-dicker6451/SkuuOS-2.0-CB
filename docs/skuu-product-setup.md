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
pnpm skuu:product-seed
```

Same harness as `pnpm skuu:spike` (raw Materials shared by code, bulk/fill Parts, jobs, trace).

## Migrations

No new migrations in this PR — uses existing `skuu*` tables from the fit-gap branch.

## Batch ticket

Matches `docs/skuu-formula-batch-design.md`: header, phases, dispensing list (kg/g/% to 4 dp), blank QC/sign-off boxes. Digital QC entry is out of scope.