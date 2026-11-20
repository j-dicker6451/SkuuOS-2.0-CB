// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import type { ReadonlyDb } from "./db";

export const MAX_TRACE_DEPTH = 10;

export type TraceNode = {
  entityId: string;
  depth: number;
  readableId: string | null;
  itemReadableId: string | null;
  quantity: number;
};

type TraceRow = {
  entity_id: string;
  depth: number;
  readable_id: string | null;
  item_readable_id: string | null;
  quantity: number;
};

/** Walk input→output (forward) or output→input (reverse) over trackedActivity edges. */
export async function traceActivityLineage(
  db: ReadonlyDb,
  companyId: string,
  startEntityId: string,
  direction: "forward" | "back",
  maxDepth = MAX_TRACE_DEPTH
): Promise<TraceNode[]> {
  const forwardStep =
    direction === "forward"
      ? sql`
          SELECT
            tao."trackedEntityId" AS next_id,
            w.depth + 1 AS next_depth,
            w.seen || tao."trackedEntityId" AS next_seen
          FROM walk w
          INNER JOIN "trackedActivityInput" tai
            ON tai."trackedEntityId" = w.entity_id
            AND tai."companyId" = ${companyId}
          INNER JOIN "trackedActivityOutput" tao
            ON tao."trackedActivityId" = tai."trackedActivityId"
            AND tao."companyId" = ${companyId}
          WHERE
            tao."trackedEntityId" IS DISTINCT FROM tai."trackedEntityId"
            AND NOT (tao."trackedEntityId" = ANY (w.seen))
            AND w.depth < ${maxDepth}
        `
      : sql`
          SELECT
            tai."trackedEntityId" AS next_id,
            w.depth + 1 AS next_depth,
            w.seen || tai."trackedEntityId" AS next_seen
          FROM walk w
          INNER JOIN "trackedActivityOutput" tao
            ON tao."trackedEntityId" = w.entity_id
            AND tao."companyId" = ${companyId}
          INNER JOIN "trackedActivityInput" tai
            ON tai."trackedActivityId" = tao."trackedActivityId"
            AND tai."companyId" = ${companyId}
          WHERE
            tai."trackedEntityId" IS DISTINCT FROM tao."trackedEntityId"
            AND NOT (tai."trackedEntityId" = ANY (w.seen))
            AND w.depth < ${maxDepth}
        `;

  const { rows } = await sql<TraceRow>`
    WITH RECURSIVE walk AS (
      SELECT
        ${startEntityId}::text AS entity_id,
        0::int AS depth,
        ARRAY[${startEntityId}::text] AS seen
      UNION ALL
      ${forwardStep}
    )
    SELECT DISTINCT ON (w.entity_id, w.depth)
      w.entity_id,
      w.depth,
      te."readableId" AS readable_id,
      i."readableId" AS item_readable_id,
      te.quantity::float8 AS quantity
    FROM walk w
    INNER JOIN "trackedEntity" te
      ON te.id = w.entity_id
      AND te."companyId" = ${companyId}
    LEFT JOIN item i
      ON i.id = te."itemId"
      AND i."companyId" = ${companyId}
    WHERE w.depth > 0
    ORDER BY w.entity_id, w.depth
  `.execute(db);

  return rows.map((r) => ({
    entityId: r.entity_id,
    depth: r.depth,
    readableId: r.readable_id,
    itemReadableId: r.item_readable_id,
    quantity: Number(r.quantity)
  }));
}

export function collapseTraceByReadableId(nodes: TraceNode[]): TraceNode[] {
  const byKey = new Map<string, TraceNode>();
  for (const n of nodes) {
    const key = n.readableId ?? n.entityId;
    const prev = byKey.get(key);
    if (!prev || n.depth < prev.depth) {
      byKey.set(key, n);
    } else if (n.depth === prev.depth && n.quantity > prev.quantity) {
      byKey.set(key, n);
    }
  }
  return [...byKey.values()];
}

export function formatTraceNodeLabel(node: TraceNode): string {
  const lot = node.readableId ?? node.entityId;
  const item = node.itemReadableId ?? "?";
  const qty =
    Number.isFinite(node.quantity) && node.quantity % 1 !== 0
      ? node.quantity.toFixed(5).replace(/\.?0+$/, "")
      : String(node.quantity);
  return `${lot} [${item}] ${qty}`;
}

export function formatTraceReport(
  nodes: TraceNode[],
  opts: {
    direction: "forward" | "back";
    startLabel: string;
    shipmentHop?: { shipmentId: string; label?: string };
  }
): { summary: string; layers: string[] } {
  const collapsed = collapseTraceByReadableId(nodes);
  const depths = [...new Set(collapsed.map((n) => n.depth))].sort(
    (a, b) => a - b
  );
  const layers: string[] = [];
  const summaryParts: string[] = [opts.startLabel];

  for (const depth of depths) {
    const atDepth = collapsed.filter((n) => n.depth === depth);
    layers.push(
      `depth ${depth}: ${atDepth.map(formatTraceNodeLabel).join("; ")}`
    );
    summaryParts.push(
      [...new Set(atDepth.map((n) => n.readableId ?? n.entityId))].join(", ")
    );
  }

  if (opts.shipmentHop && opts.direction === "forward") {
    const shipLabel =
      opts.shipmentHop.label ?? `shipment ${opts.shipmentHop.shipmentId}`;
    layers.push(`shipment: ${shipLabel}`);
    summaryParts.push(shipLabel);
  }

  const arrow = opts.direction === "forward" ? " -> " : " <- ";
  return { summary: summaryParts.join(arrow), layers };
}
