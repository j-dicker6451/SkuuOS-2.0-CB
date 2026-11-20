// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from "kysely";
import type { SpikeContext } from "./context";

type Db = SpikeContext["db"];

const MAX_TRACE_DEPTH = 10;

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
  db: Db,
  companyId: string,
  startEntityId: string,
  direction: "forward" | "back"
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
            AND w.depth < ${MAX_TRACE_DEPTH}
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
            AND w.depth < ${MAX_TRACE_DEPTH}
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

function collapseKey(node: TraceNode) {
  return node.readableId ?? node.entityId;
}

function collapseByReadableId(nodes: TraceNode[]): TraceNode[] {
  const byKey = new Map<string, TraceNode>();
  for (const n of nodes) {
    const key = collapseKey(n);
    const prev = byKey.get(key);
    if (!prev || n.depth < prev.depth) {
      byKey.set(key, n);
    } else if (n.depth === prev.depth && n.quantity > prev.quantity) {
      byKey.set(key, n);
    }
  }
  return [...byKey.values()];
}

function formatNodeLabel(node: TraceNode) {
  const lot = node.readableId ?? node.entityId;
  const item = node.itemReadableId ?? "?";
  const qty =
    Number.isFinite(node.quantity) && node.quantity % 1 !== 0
      ? node.quantity.toFixed(5).replace(/\.?0+$/, "")
      : String(node.quantity);
  return `${lot} [${item}] ${qty}`;
}

/** Depth-grouped lines plus an arrow summary (readableId collapsed). */
export function formatTraceReport(
  nodes: TraceNode[],
  opts: {
    direction: "forward" | "back";
    startLabel: string;
    shipmentHop?: { shipmentId: string; label?: string };
  }
): { summary: string; layers: string[] } {
  const collapsed = collapseByReadableId(nodes);
  const depths = [...new Set(collapsed.map((n) => n.depth))].sort(
    (a, b) => a - b
  );
  const layers: string[] = [];
  const summaryParts: string[] = [opts.startLabel];

  for (const depth of depths) {
    const atDepth = collapsed.filter((n) => n.depth === depth);
    const labels = atDepth.map(formatNodeLabel);
    layers.push(`  depth ${depth}: ${labels.join("; ")}`);
    const ids = [
      ...new Set(atDepth.map((n) => n.readableId ?? n.entityId))
    ];
    summaryParts.push(ids.join(", "));
  }

  if (opts.shipmentHop && opts.direction === "forward") {
    const shipLabel =
      opts.shipmentHop.label ??
      `shipment ${opts.shipmentHop.shipmentId.slice(0, 12)}…`;
    layers.push(`  shipment: ${shipLabel}`);
    summaryParts.push(shipLabel);
  }

  const arrow = opts.direction === "forward" ? " → " : " ← ";
  return {
    summary: summaryParts.join(arrow),
    layers
  };
}

export type SpikeTraceExpectations = {
  forwardFromRawId: string;
  forwardNodes: TraceNode[];
  reverseFromShippedId: string;
  reverseNodes: TraceNode[];
  bulkLotId: string;
  allRawLotIds: string[];
  fillLotIds: string[];
  shipmentId: string;
};

function entityReachable(
  nodes: TraceNode[],
  entityId: string,
  extraIds?: string[]
): boolean {
  const ids = new Set(nodes.map((n) => n.entityId));
  if (extraIds) for (const id of extraIds) ids.add(id);
  return ids.has(entityId);
}

export async function assertSharedRawLotCrossBulkJobs(
  db: Db,
  companyId: string,
  rawLotId: string,
  bulkLotIds: string[],
  tolerance = 1e-4
): Promise<void> {
  const lot = await db
    .selectFrom("trackedEntity")
    .select(["quantity", "readableId"])
    .where("companyId", "=", companyId)
    .where("id", "=", rawLotId)
    .executeTakeFirst();
  if (!lot) {
    throw new Error(`Shared raw lot ${rawLotId} not found`);
  }
  if (Number(lot.quantity) < -tolerance) {
    throw new Error(
      `Shared raw lot ${lot.readableId ?? rawLotId} has negative quantity ${lot.quantity}`
    );
  }

  const consumptionRows = await db
    .selectFrom("trackedActivityInput as tai")
    .innerJoin("trackedActivity as ta", "ta.id", "tai.trackedActivityId")
    .select(["ta.id as activityId", "ta.sourceDocumentId", "tai.quantity"])
    .where("tai.companyId", "=", companyId)
    .where("tai.trackedEntityId", "=", rawLotId)
    .where("ta.sourceDocument", "=", "Job Operation")
    .execute();

  if (consumptionRows.length < 2) {
    throw new Error(
      `Expected ≥2 Job Operation consumptions from raw lot ${lot.readableId ?? rawLotId}, got ${consumptionRows.length}`
    );
  }

  const totalConsumed = consumptionRows.reduce(
    (acc, row) => acc + Number(row.quantity ?? 0),
    0
  );
  if (totalConsumed <= 0) {
    throw new Error("No positive consumption qty recorded on shared raw lot");
  }

  const forwardNodes = await traceActivityLineage(
    db,
    companyId,
    rawLotId,
    "forward"
  );
  for (const bulkId of bulkLotIds) {
    if (!entityReachable(forwardNodes, bulkId)) {
      throw new Error(
        `Forward trace from shared raw lot ${lot.readableId ?? rawLotId} missing bulk lot ${bulkId}`
      );
    }
  }
}

export function assertSpikeTrace(expect: SpikeTraceExpectations): void {
  const { forwardNodes, reverseNodes, bulkLotId, allRawLotIds, fillLotIds } =
    expect;

  if (!entityReachable(forwardNodes, bulkLotId)) {
    throw new Error(
      `Forward trace from raw lot missing bulk lot ${bulkLotId} (got ${forwardNodes.length} nodes)`
    );
  }

  for (const fillId of fillLotIds) {
    if (!entityReachable(forwardNodes, fillId)) {
      throw new Error(
        `Forward trace missing fill lot ${fillId}`
      );
    }
  }

  if (!expect.shipmentId) {
    throw new Error("Forward trace missing shipmentId");
  }

  if (!entityReachable(reverseNodes, bulkLotId)) {
    throw new Error(
      `Reverse trace from shipped lot missing bulk lot ${bulkLotId}`
    );
  }

  const missingRaw = allRawLotIds.filter(
    (id) => !entityReachable(reverseNodes, id)
  );
  if (missingRaw.length > 0) {
    throw new Error(
      `Reverse trace missing ${missingRaw.length} raw lot(s): ${missingRaw.join(", ")}`
    );
  }
}