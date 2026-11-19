# SkuuOS formula spike

End-to-end: raw lots → bulk % job → two fill jobs → shipment → trace.

```bash
# From repo root (loads .env then .env.local automatically):
pnpm skuu:spike
```

Requires migrations, seed (`test@carbon.ms` by default), and `pnpm dev` / `crbn up` for PostgREST.

UoM and currency codes are read from the seeded company (`kg`, `EA`, `company.baseCurrencyCode`) — not hardcoded.

Parts are created with `upsertPart` (same as **New Part**), never raw `item` inserts — `app.sync_in_progress` on Kysely seed transactions skips item interceptors and breaks receipts.

Teardown deletes by **`readableId` prefix** (and legacy `id` prefix), including `itemCost`, `itemReplenishment`, `itemPlanning`, jobs, lots, and Skuu rows.

| Step | ERP mirror |
| --- | --- |
| Receive raw | `postInventoryAdjustment` (manual positive adj.) |
| Bulk/fill jobs | `insertJob` → `recalculateJobRequirements` (Skuu gross-up) → release → **MES** `trackedEntitiesToOperation` + `jobOperationBatchComplete` → `complete_job_to_inventory` |
| Ship | `createDocument` + `postShipment` |

- Input: `example-formula.json` or `SKUU_SPIKE_INPUT`
- PostgREST URL: `SUPABASE_URL` or **`SKUU_SPIKE_SUPABASE_URL`** (e.g. `http://[::1]:54321` when Cursor Agents shadows `127.0.0.1:54321`)
- Local-only: `*.local.json` (gitignored)
- Report: `report-last-run.txt` in this folder