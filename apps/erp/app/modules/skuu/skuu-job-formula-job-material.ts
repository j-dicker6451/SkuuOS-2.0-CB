// SPDX-License-Identifier: AGPL-3.0-only

export type SkuuFormulaLineRef = {
  methodMaterialId: string;
  itemId: string | null;
  order: number;
};

export type SkuuJobMaterialRef = {
  id: string;
  itemId: string;
  order: number;
};

/**
 * Map make-method formula lines to exploded job materials (job tree keys by jobMaterial.id).
 * Matches itemId + order first so duplicate ingredients (e.g. water in two phases) stay distinct.
 */
export function mapFormulaLinesToJobMaterials(
  formulaLines: SkuuFormulaLineRef[],
  jobMaterials: SkuuJobMaterialRef[]
): Map<string, string> {
  const itemLineCount = new Map<string, number>();
  for (const line of formulaLines) {
    if (!line.itemId) continue;
    itemLineCount.set(line.itemId, (itemLineCount.get(line.itemId) ?? 0) + 1);
  }

  const usedJm = new Set<string>();
  const out = new Map<string, string>();

  for (const line of formulaLines) {
    if (!line.itemId) continue;
    const match =
      jobMaterials.find(
        (jm) =>
          !usedJm.has(jm.id) &&
          jm.itemId === line.itemId &&
          Number(jm.order) === Number(line.order)
      ) ??
      ((itemLineCount.get(line.itemId) ?? 0) === 1
        ? jobMaterials.find(
            (jm) => !usedJm.has(jm.id) && jm.itemId === line.itemId
          )
        : undefined);

    if (!match) continue;
    usedJm.add(match.id);
    out.set(line.methodMaterialId, match.id);
  }

  return out;
}