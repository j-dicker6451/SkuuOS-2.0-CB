# SkuuOS bulk formula & batch record (design)

This document extends the AGPL **SkuuOS** formula layer (`skuu_*` tables). It is not Enterprise (`packages/ee`) code.

## What this PR ships

- **Phases** — `skuuFormulaPhase` (per make method): `phaseNumber`, free-text `instructions`, optional `methodOperationId` to align with BoP operations / work instructions.
- **Line metadata** — `skuuMethodMaterialFormula.phaseNumber`, `lineKind` (`ingredient` | `bulk_lot_rework`), optional `sourceTrackedEntityId` + `reworkPercentWw` for rework from an existing bulk lot.
- **Bulk header** — `productDensityGPerMl`, `expectedYieldPercent` (manufacture = target ÷ yield%).
- **Dispense scaffold** — `skuuJobMaterialDispense` for multiple lots per job material line (qty kg, supplier batch no., location); no MES execution UI in this PR.

## Yield (batch tickets)

```
manufactureAmount = targetFinishedAmount / (expectedYieldPercent / 100)
```

Example: 240 L target at 98% yield → manufacture 240 / 0.98 L (convert with density to kg for MRP/job scaling).

## Density

```
kg = liters × productDensityGPerMl
liters = kg / productDensityGPerMl
```

Example: 244.898 L × 1.04 g/mL = 254.694 kg.

## Phases vs operations

| Approach | When |
|----------|------|
| Link `skuuFormulaPhase.methodOperationId` | Operation exists on BoP; copy phase instructions into `methodOperation.workInstruction` at release (future job). |
| Phase-only | No matching op; show phase block on SkuuOS formula panel and on job traveler (future). |

## Multi-lot dispense

One `jobMaterial` line → many `skuuJobMaterialDispense` rows summing to planned kg. Each row references `trackedEntityId`, optional supplier batch number, and `storageLocationId`. Issue/pick flows remain Carbon `trackedActivity` / pick lists; dispense rows are the **planned** split SkuuOS records against the ticket.

## Rework lines

`lineKind = bulk_lot_rework` with `sourceTrackedEntityId` and `reworkPercentWw` (e.g. 94.5% of an old bulk lot) instead of fresh raw % w/w.

## Future: in-process batch record (not in this PR)

Build on existing **job operations** and **operation steps**:

1. **Batch header** on `job` (or `skuuJobBatch` 1:1): target L/kg, expected yield, density snapshot, ticket id.
2. **Per operation / phase** — mirror `skuuFormulaPhase` onto `jobOperation`; append step-level checks to `jobOperationStep` or SkuuOS `skuuJobPhaseLog` (QC reading, adjustment, sign-off user/time).
3. **Dispense execution** — MES issue material writes `skuuJobMaterialDispense` + consumption; compare planned vs actual on phase complete.
4. **Actual yield** — on job complete, store `actualYieldPercent` vs target; variance on batch record only (no change to core costing unless configured).

Read-only **SkuuOS MCP** (next PR) can expose formula phases, dispense plan, and phase instructions without touching EE modules.