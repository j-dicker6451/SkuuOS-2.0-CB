// SPDX-License-Identifier: AGPL-3.0-only

import { useRouteData } from "@carbon/react";
import { useMatches, useParams } from "react-router";
import { path } from "~/utils/path";

type PartLayoutMatch = {
  data: unknown;
  params?: { itemId?: string };
};

/** Resolve parent `$itemId` loader data on nested part tabs (pure, testable). */
export function resolvePartLayoutDataFromMatches<T extends object>(
  itemId: string | undefined,
  exact: T | undefined,
  matches: PartLayoutMatch[]
): T | undefined {
  if (!itemId) return undefined;
  if (exact) return exact;

  const layout = matches.find(
    (m) =>
      m.data != null &&
      typeof m.data === "object" &&
      "partSummary" in (m.data as object) &&
      m.params?.itemId === itemId
  );
  return layout?.data as T | undefined;
}

/** Parent `$itemId` loader data from any nested part tab (details, formulation, …). */
export function usePartLayoutData<T extends object>(): T | undefined {
  const { itemId } = useParams();
  const exact = useRouteData<T>(path.to.part(itemId ?? "__missing__"));
  const matches = useMatches();
  return resolvePartLayoutDataFromMatches(itemId, exact, matches);
}
