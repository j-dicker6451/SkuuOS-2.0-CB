// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { completeSkuuJobPhase } from "./skuu-batch-record.service";

describe("skuu batch record service", () => {
  it("rejects completing a locked phase without correction reason", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { locked: true } })
            }))
          }))
        })),
        upsert: vi.fn()
      }))
    } as never;

    await expect(
      completeSkuuJobPhase(client, {
        jobId: "job1",
        companyId: "co1",
        userId: "u1",
        phaseNumber: 1,
        notes: "done"
      })
    ).rejects.toThrow(/locked/i);
  });
});