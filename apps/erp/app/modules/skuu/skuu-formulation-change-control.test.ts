// SPDX-License-Identifier: AGPL-3.0-only

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  assertSkuuFormulationEditable,
  createSkuuFormulationVersion,
  SkuuFormulationLockedError
} from "./skuu-formulation-change-control.service";
import { diffSkuuFormulationPercents } from "./skuu-formulation-diff";
import * as skuuBulk from "./skuu-bulk.service";

vi.mock("./skuu-bulk.service", () => ({
  loadSkuuBulkProfile: vi.fn()
}));

vi.mock("./skuu-formulation.service", () => ({
  loadSkuuFormulationView: vi.fn()
}));

vi.mock("./skuu-formulation-copy.service", () => ({
  copySkuuFormulationBetweenMakeMethods: vi.fn()
}));

vi.mock("~/modules/items/items.service", () => ({
  createMakeMethodVersion: vi.fn(),
  activateMethodVersion: vi.fn()
}));

describe("diffSkuuFormulationPercents", () => {
  it("reports added, removed, and changed lines", () => {
    const prev = [
      {
        methodMaterialId: "a",
        itemReadableId: "RM-A",
        percentWw: 10,
        phaseNumber: 1
      },
      {
        methodMaterialId: "b",
        itemReadableId: "RM-B",
        percentWw: 20,
        phaseNumber: 1
      }
    ];
    const cur = [
      {
        methodMaterialId: "a",
        itemReadableId: "RM-A",
        percentWw: 12,
        phaseNumber: 1
      },
      {
        methodMaterialId: "c",
        itemReadableId: "RM-C",
        percentWw: 88,
        phaseNumber: 1
      }
    ];
    const diff = diffSkuuFormulationPercents(prev, cur);
    expect(diff.some((d) => d.kind === "changed" && d.line.methodMaterialId === "a")).toBe(
      true
    );
    expect(diff.some((d) => d.kind === "removed" && d.line.methodMaterialId === "b")).toBe(
      true
    );
    expect(diff.some((d) => d.kind === "added" && d.line.methodMaterialId === "c")).toBe(
      true
    );
  });
});

describe("assertSkuuFormulationEditable", () => {
  beforeEach(() => {
    vi.mocked(skuuBulk.loadSkuuBulkProfile).mockReset();
  });

  it("throws when bulk is enabled and revision is approved", async () => {
    vi.mocked(skuuBulk.loadSkuuBulkProfile).mockResolvedValue({
      enabled: true,
      batchBasisKg: 1,
      yieldLossPercent: 0,
      productDensityGPerMl: null,
      expectedYieldPercent: 100
    });

    const client = {
      from: (table: string) => {
        if (table === "skuuFormulationRevision") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      status: "approved",
                      makeMethodId: "mm1",
                      companyId: "c1",
                      itemId: "i1",
                      version: 1,
                      changeReason: "x",
                      sourceMakeMethodId: null,
                      createdAt: "",
                      createdBy: "",
                      submittedAt: null,
                      submittedBy: null,
                      approvedAt: null,
                      approvedBy: null,
                      withdrawnAt: null,
                      withdrawnBy: null
                    },
                    error: null
                  })
                })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            })
          })
        };
      }
    } as unknown as SupabaseClient;

    await expect(
      assertSkuuFormulationEditable(client, "mm1", "c1")
    ).rejects.toBeInstanceOf(SkuuFormulationLockedError);
  });
});

describe("createSkuuFormulationVersion", () => {
  it("requires a non-empty change reason", async () => {
    const result = await createSkuuFormulationVersion({} as never, {} as never, {
      sourceMakeMethodId: "src",
      changeReason: "   ",
      companyId: "c1",
      userId: "u1"
    });
    expect(result).toEqual({
      error: "A reason for the formulation change is required."
    });
  });

  it("rejects cloning when source is not approved", async () => {
    vi.mocked(skuuBulk.loadSkuuBulkProfile).mockResolvedValue({
      enabled: true,
      batchBasisKg: 1,
      yieldLossPercent: 0,
      productDensityGPerMl: null,
      expectedYieldPercent: 100
    });
    const client = {
      from: (table: string) => {
        if (table === "skuuFormulationRevision") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { status: "draft" },
                    error: null
                  })
                })
              })
            })
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null })
              })
            })
          })
        };
      }
    } as unknown as SupabaseClient;

    const result = await createSkuuFormulationVersion(client, {} as never, {
      sourceMakeMethodId: "src",
      changeReason: "Stabiliser swap",
      companyId: "c1",
      userId: "u1"
    });
    expect(result).toEqual({
      error: "Only an approved formulation can be cloned into a new version."
    });
  });
});
