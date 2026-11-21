// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { evaluateSkuuFormulationJobGate } from "./skuu-formulation-change-control.service";

describe("evaluateSkuuFormulationJobGate", () => {
  it("allows non-Skuu bulk parts", () => {
    expect(
      evaluateSkuuFormulationJobGate({
        usesSkuuBulk: false,
        approved: null,
        approvedStatus: null
      })
    ).toEqual({ ok: true, skuuBulk: false });
  });

  it("refuses jobs when bulk is enabled but nothing is approved", () => {
    expect(
      evaluateSkuuFormulationJobGate({
        usesSkuuBulk: true,
        approved: null,
        approvedStatus: null
      })
    ).toEqual({
      ok: false,
      message:
        "Production jobs for this bulk part require an approved Skuu formulation version."
    });
  });

  it("refuses jobs when only a draft version exists", () => {
    expect(
      evaluateSkuuFormulationJobGate({
        usesSkuuBulk: true,
        approved: { makeMethodId: "mm1", version: 1.01 },
        approvedStatus: "draft"
      })
    ).toEqual({
      ok: false,
      message: "Formulation version is draft; only approved versions can release jobs."
    });
  });

  it("pins jobs to the approved make method version", () => {
    expect(
      evaluateSkuuFormulationJobGate({
        usesSkuuBulk: true,
        approved: { makeMethodId: "mm-approved", version: 1 },
        approvedStatus: "approved"
      })
    ).toEqual({
      ok: true,
      skuuBulk: true,
      makeMethodId: "mm-approved",
      version: 1
    });
  });
});