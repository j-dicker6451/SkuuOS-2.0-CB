# SkuuOS formula spike

Validate schema and formula math against your local database.

```bash
# After `pnpm dev` / migrations applied and satellite seed present:
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm skuu:spike
```

- Committed input: `example-formula.json`
- Local-only inputs: `*.local.json` (gitignored)
- Last report: `report-last-run.txt`

For a full end-to-end trace (receipt → bulk job → fills → ship), run postings in ERP after the spike passes schema checks.