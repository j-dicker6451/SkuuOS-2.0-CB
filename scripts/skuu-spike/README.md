# SkuuOS formula spike

End-to-end harness: raw lots → bulk % job → two fill jobs from one bulk lot → shipment → forward/reverse trace.

```bash
# After migrations, seed (satellite), and `pnpm dev` / `crbn up` (PostgREST for RPCs):
pnpm skuu:spike

# Optional:
SKUU_SPIKE_INPUT=scripts/skuu-spike/example-formula.json
SKUU_SPIKE_USER=test@carbon.ms
SKUU_SPIKE_PREFIX=skuu-spike
```

- Committed input: `example-formula.json`
- Local-only inputs: `*.local.json` (gitignored)
- Last report: `report-last-run.txt`

Uses ERP service postings (`post-inventory-adjustment`, `issue`, `completeJob`, `post-shipment`) and Carbon RPCs (`complete_job_to_inventory`, `get_next_sequence`).