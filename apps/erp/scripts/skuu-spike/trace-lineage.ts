// SPDX-License-Identifier: AGPL-3.0-only

export {
  collapseTraceByReadableId as collapseByReadableId,
  formatTraceReport,
  traceActivityLineage,
  type TraceNode
} from "@skuu/readonly/trace";

export type SpikeTraceExpectations = {
  forwardFromRawId: string;
  forwardNodes: import("@skuu/readonly/trace").TraceNode[];
  reverseFromShippedId: string;
  reverseNodes: import("@skuu/readonly/trace").TraceNode[];
  bulkLotId: string;
  allRawLotIds: string[];
  fillLotIds: string[];
  shipmentId: string;
};

function entityReachable(
  nodes: import("@skuu/readonly/trace").TraceNode[],
  entityId: string
): boolean {
  return nodes.some((n) => n.entityId === entityId);
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
      throw new Error(`Forward trace missing fill lot ${fillId}`);
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