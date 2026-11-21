// SPDX-License-Identifier: AGPL-3.0-only

export type SkuuFormulationLineSnapshot = {
  methodMaterialId: string;
  itemReadableId: string | null;
  percentWw: number | null;
  phaseNumber: number | null;
};

export type SkuuFormulationDiffEntry =
  | { kind: "added"; line: SkuuFormulationLineSnapshot }
  | { kind: "removed"; line: SkuuFormulationLineSnapshot }
  | {
      kind: "changed";
      line: SkuuFormulationLineSnapshot;
      previousPercentWw: number | null;
    };

export function diffSkuuFormulationPercents(
  previous: SkuuFormulationLineSnapshot[],
  current: SkuuFormulationLineSnapshot[]
): SkuuFormulationDiffEntry[] {
  const prevById = new Map(previous.map((l) => [l.methodMaterialId, l]));
  const curById = new Map(current.map((l) => [l.methodMaterialId, l]));
  const out: SkuuFormulationDiffEntry[] = [];

  for (const [id, line] of curById) {
    const prev = prevById.get(id);
    if (!prev) {
      out.push({ kind: "added", line });
      continue;
    }
    if ((prev.percentWw ?? null) !== (line.percentWw ?? null)) {
      out.push({
        kind: "changed",
        line,
        previousPercentWw: prev.percentWw ?? null
      });
    }
  }
  for (const [id, line] of prevById) {
    if (!curById.has(id)) out.push({ kind: "removed", line });
  }
  return out;
}