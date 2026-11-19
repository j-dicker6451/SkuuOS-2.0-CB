# SkuuOS formula spike

End-to-end: raw lots → bulk % job → two fill jobs → shipment → trace.

```bash
# From repo root (loads .env then .env.local automatically):
pnpm skuu:spike
```

Requires migrations, seed (`test@carbon.ms` by default), and `pnpm dev` / `crbn up` for PostgREST.

UoM and currency codes are read from the seeded company (`kg`, `EA`, `company.baseCurrencyCode`) — not hardcoded.

- Input: `example-formula.json` or `SKUU_SPIKE_INPUT`
- Local-only: `*.local.json` (gitignored)
- Report: `report-last-run.txt` in this folder