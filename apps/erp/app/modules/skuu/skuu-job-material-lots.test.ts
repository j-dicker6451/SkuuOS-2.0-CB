// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import {
  loadSkuuJobMaterialLotsFromTrackedActivity,
  mapSkuuLotsToFormulaMethodMaterials
} from "./skuu-job-material-lots";

/** MES consume rows (PLUS01 bulk job after tracked issue). */
const consumeFixture = {
  activities: [
    { id: "ta_1", sourceDocumentId: "jm_water_phase1" },
    { id: "ta_2", sourceDocumentId: "jm_water_phase6" }
  ],
  inputs: [
    {
      trackedActivityId: "ta_1",
      trackedEntityId: "te_raw_a",
      quantity: 159.844
    },
    {
      trackedActivityId: "ta_2",
      trackedEntityId: "te_raw_b",
      quantity: 1.018
    }
  ],
  trackedEntities: [
    {
      id: "te_raw_a",
      readableId: "skuu-spike-PLUS01-1A945-A",
      sourceDocumentReadableId: "RECV-1A945-A"
    },
    {
      id: "te_raw_b",
      readableId: "skuu-spike-PLUS01-1A92-WATER-B",
      sourceDocumentReadableId: "RECV-WATER-B"
    }
  ]
};

function query(table: string, fixture = consumeFixture) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.in = vi.fn(self);
  builder.filter = vi.fn(self);
  builder.order = vi.fn(self);
  builder.not = vi.fn(self);
  builder.or = vi.fn(self);
  builder.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolvePayload(table, fixture)).then(resolve, reject);
  builder.catch = (reject: (e: unknown) => void) =>
    Promise.resolve(resolvePayload(table, fixture)).catch(reject);
  return builder;
}

function resolvePayload(table: string, fixture: typeof consumeFixture) {
  switch (table) {
    case "trackedActivity":
      return { data: fixture.activities, error: null };
    case "trackedActivityInput":
      return { data: fixture.inputs, error: null };
    case "trackedEntity":
      return { data: fixture.trackedEntities, error: null };
    case "skuuJobMaterialDispense":
      return { data: [], error: null };
    case "itemLedger":
      return { data: [], error: null };
    case "jobMaterial":
      return {
        data: [
          {
            id: "jm_water_phase1",
            itemId: "item_water",
            order: 1
          },
          {
            id: "jm_water_phase6",
            itemId: "item_water",
            order: 6
          }
        ],
        error: null
      };
    default:
      return { data: [], error: null };
  }
}

function mockConsumeClient(fixture = consumeFixture) {
  return {
    from: vi.fn((table: string) => query(table, fixture))
  } as never;
}

describe("skuu-job-material-lots", () => {
  it("maps trackedActivity consume inputs to job materials with readableIds", async () => {
    const client = mockConsumeClient();
    const map = await loadSkuuJobMaterialLotsFromTrackedActivity(
      client,
      "co_test",
      "job_bulk",
      ["jm_water_phase1", "jm_water_phase6"]
    );
    expect(map.get("jm_water_phase1")?.[0]?.trackedEntityReadableId).toBe(
      "skuu-spike-PLUS01-1A945-A"
    );
    expect(map.get("jm_water_phase6")?.[0]?.quantityKg).toBeCloseTo(1.018, 3);
  });

  it("maps lots to distinct formula lines when the same item appears twice", async () => {
    const client = mockConsumeClient();
    const byFormula = await mapSkuuLotsToFormulaMethodMaterials(
      client,
      "co_test",
      "job_bulk",
      [
        {
          methodMaterialId: "mm_water_p1",
          itemId: "item_water",
          order: 1
        },
        {
          methodMaterialId: "mm_water_p6",
          itemId: "item_water",
          order: 6
        }
      ]
    );
    expect(byFormula.get("mm_water_p1")?.[0]?.trackedEntityReadableId).toBe(
      "skuu-spike-PLUS01-1A945-A"
    );
    expect(byFormula.get("mm_water_p6")?.[0]?.trackedEntityReadableId).toBe(
      "skuu-spike-PLUS01-1A92-WATER-B"
    );
  });
});