// SPDX-License-Identifier: AGPL-3.0-only

import { grossInputKg, lineKgFromPercent } from "@skuu/formula";
import type { SkuuBulkProfile } from "./skuu-bulk.service";
import type {
  SkuuFormulaPhaseRow,
  SkuuFormulationMaterialLine
} from "./skuu-formulation.service";

export const SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER =
  "Add method instructions for this phase in Formulation & method.";

export type SkuuPhasedFormulaBlock = {
  phaseNumber: number;
  instructions: string;
    lines: Array<{
    methodMaterialId: string;
    itemReadableId: string | null;
    itemName: string | null;
    percentWw: number | null;
    kgPerBatch: number | null;
    order: number;
  }>;
};

export function mergeSkuuFormulaPhases(
  phases: SkuuFormulaPhaseRow[],
  materials: SkuuFormulationMaterialLine[]
): SkuuFormulaPhaseRow[] {
  const numbers = new Set<number>();
  for (const p of phases) numbers.add(p.phaseNumber);
  for (const m of materials) numbers.add(m.phaseNumber ?? 1);
  if (numbers.size === 0) numbers.add(1);

  return [...numbers].sort((a, b) => a - b).map((phaseNumber) => {
    const found = phases.find((p) => p.phaseNumber === phaseNumber);
    const instructions = found?.instructions?.trim();
    return {
      phaseNumber,
      instructions: instructions
        ? found!.instructions
        : SKUU_PHASE_INSTRUCTIONS_PLACEHOLDER,
      methodOperationId: found?.methodOperationId ?? null
    };
  });
}

export function buildSkuuPhasedFormulaBlocks(
  phases: SkuuFormulaPhaseRow[],
  materials: SkuuFormulationMaterialLine[],
  profile: SkuuBulkProfile | null
): SkuuPhasedFormulaBlock[] {
  const merged = mergeSkuuFormulaPhases(phases, materials);
  const grossBasis =
    profile?.enabled && profile.batchBasisKg
      ? grossInputKg(profile.batchBasisKg, profile.expectedYieldPercent)
      : (profile?.batchBasisKg ?? 1);

  return merged.map((phase) => {
    const lines = materials
      .filter(
        (m) =>
          (m.phaseNumber ?? 1) === phase.phaseNumber &&
          m.lineKind !== "bulk_lot_rework" &&
          m.percentWw != null
      )
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        methodMaterialId: m.methodMaterialId,
        itemReadableId: m.itemReadableId,
        itemName: m.itemName,
        percentWw: m.percentWw,
        kgPerBatch:
          m.percentWw != null
            ? lineKgFromPercent(Number(m.percentWw), grossBasis)
            : null,
        order: m.order
      }));
    return {
      phaseNumber: phase.phaseNumber,
      instructions: phase.instructions,
      lines
    };
  });
}