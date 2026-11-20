// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import type { BulkBatchTicket } from "~/modules/skuu/skuu-batch-ticket.server";
import { loader } from "./$jobId.bulk-batch-ticket";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn().mockResolvedValue({
    client: {},
    companyId: "co_test"
  })
}));

vi.mock("~/modules/skuu/skuu-batch-ticket.server", () => ({
  buildBulkBatchTicket: vi.fn()
}));

import { buildBulkBatchTicket } from "~/modules/skuu/skuu-batch-ticket.server";

const ticketFixture: BulkBatchTicket = {
  productName: "BLD BRO NIGHT",
  productCode: "BULK-SKUU1991",
  batchNumber: "skuu-spike-SKUU1991-JOB-BULK",
  batchSizeKg: 100,
  batchSizeL: 102.04,
  densityGPerMl: 0.98,
  expectedYieldPercent: 98,
  targetFinishedKg: 100,
  phases: [
    {
      phaseNumber: 1,
      instructions: "Heat water, add Carbopol.",
      lines: [
        {
          phaseNumber: 1,
          methodMaterialId: "mm_carbopol",
          partCode: "1A102",
          name: "Carbopol Ultrez 21",
          percentWw: 0.15,
          kg: 0.1531,
          grams: 153.06,
          batchLots: [
            {
              trackedEntityReadableId: "RAW-LOT-1",
              supplierBatchNumber: "SB-99",
              quantityKg: 0.1531
            }
          ]
        }
      ]
    }
  ],
  percentTotal: 100,
  percentOk: true
};

describe("bulk-batch-ticket loader", () => {
  it("returns serializable ticket when buildBulkBatchTicket resolves (loader 200)", async () => {
    vi.mocked(buildBulkBatchTicket).mockResolvedValue(ticketFixture);
    const res = await loader({
      request: new Request("http://localhost/x/job/job_x/bulk-batch-ticket"),
      params: { jobId: "job_x" },
      context: {}
    } as never);
    expect(res.ticket.phases).toHaveLength(1);
    expect(res.ticket.phases[0]?.lines[0]?.name).toBe("Carbopol Ultrez 21");
    const json = JSON.stringify(res);
    const roundtrip = JSON.parse(json) as typeof res;
    expect(roundtrip.ticket.phases[0]?.lines[0]?.partCode).toBe("1A102");
  });

  it("404 when ticket cannot be built", async () => {
    vi.mocked(buildBulkBatchTicket).mockResolvedValue(null);
    await expect(
      loader({
        request: new Request("http://localhost/x/job/job_x/bulk-batch-ticket"),
        params: { jobId: "job_x" },
        context: {}
      } as never)
    ).rejects.toMatchObject({ status: 404 });
  });
});