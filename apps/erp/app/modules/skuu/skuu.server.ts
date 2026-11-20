// SPDX-License-Identifier: AGPL-3.0-only

import { defineServiceFn } from "@carbon/api/service-fn.server";
import { z } from "zod";
import {
  skuuBulkProfileValidator,
  skuuFormulaPhaseValidator,
  skuuMaterialPercentValidator
} from "./skuu.models";
import {
  assertSkuuBulkFormulaValid,
  loadSkuuBulkProfile,
  loadSkuuFormulaPercents,
  upsertSkuuBulkProfile,
  upsertSkuuMaterialPercent
} from "./skuu-bulk.service";
import {
  loadSkuuFormulationView,
  upsertSkuuFormulaPhase
} from "./skuu-formulation.service";

export const saveSkuuBulkProfile = defineServiceFn({
  input: skuuBulkProfileValidator,
  permission: { update: "parts" },
  async run(ctx, input) {
    const result = await upsertSkuuBulkProfile(ctx.asCaller.supabase, {
      makeMethodId: input.makeMethodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      profile: {
        enabled: input.enabled,
        batchBasisKg: input.batchBasisKg,
        yieldLossPercent: input.yieldLossPercent,
        productDensityGPerMl: input.productDensityGPerMl ?? null,
        expectedYieldPercent: input.expectedYieldPercent
      }
    });
    if (result.error) return { data: null, error: result.error };
    if (input.enabled) {
      try {
        await assertSkuuBulkFormulaValid(
          ctx.asCaller.supabase,
          input.makeMethodId,
          ctx.company.id
        );
      } catch (error) {
        return {
          data: null,
          error: {
            message:
              error instanceof Error ? error.message : "Invalid bulk formula"
          }
        };
      }
    }
    return { data: result.data, error: null };
  }
});

export const saveSkuuMaterialPercent = defineServiceFn({
  input: skuuMaterialPercentValidator,
  permission: { update: "parts" },
  async run(ctx, input) {
    const result = await upsertSkuuMaterialPercent(ctx.asCaller.supabase, {
      methodMaterialId: input.methodMaterialId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      percentWw: input.percentWw,
      phaseNumber: input.phaseNumber,
      lineKind: input.lineKind
    });
    if (result.error) return { data: null, error: result.error };
    const { data: material } = await ctx.asCaller.supabase
      .from("methodMaterial")
      .select("makeMethodId")
      .eq("id", input.methodMaterialId)
      .single();
    if (material?.makeMethodId) {
      try {
        await assertSkuuBulkFormulaValid(
          ctx.asCaller.supabase,
          material.makeMethodId,
          ctx.company.id
        );
      } catch (error) {
        return {
          data: null,
          error: {
            message:
              error instanceof Error ? error.message : "Invalid bulk formula"
          }
        };
      }
    }
    return { data: result.data, error: null };
  }
});

export const saveSkuuFormulaPhase = defineServiceFn({
  input: skuuFormulaPhaseValidator,
  permission: { update: "parts" },
  async run(ctx, input) {
    const result = await upsertSkuuFormulaPhase(ctx.asCaller.supabase, {
      makeMethodId: input.makeMethodId,
      companyId: ctx.company.id,
      userId: ctx.auditUserId,
      phaseNumber: input.phaseNumber,
      instructions: input.instructions,
      methodOperationId: input.methodOperationId ?? null
    });
    if (result.error) return { data: null, error: result.error };
    return { data: true, error: null };
  }
});

export const getSkuuFormulation = defineServiceFn({
  input: z.object({ makeMethodId: z.string() }),
  permission: { read: "parts" },
  async run(ctx, input) {
    const view = await loadSkuuFormulationView(
      ctx.asCaller.supabase,
      input.makeMethodId,
      ctx.company.id
    );
    return { data: view, error: null };
  }
});

export const getSkuuBulkContext = defineServiceFn({
  input: z.object({ makeMethodId: z.string() }),
  permission: { read: "parts" },
  async run(ctx, input) {
    const [profile, percents] = await Promise.all([
      loadSkuuBulkProfile(
        ctx.asCaller.supabase,
        input.makeMethodId,
        ctx.company.id
      ),
      loadSkuuFormulaPercents(
        ctx.asCaller.supabase,
        input.makeMethodId,
        ctx.company.id
      )
    ]);
    return {
      data: {
        profile: profile ?? {
          enabled: false,
          batchBasisKg: 1,
          yieldLossPercent: 0,
          productDensityGPerMl: null,
          expectedYieldPercent: 100
        },
        percents: [...percents.entries()].map(
          ([methodMaterialId, percentWw]) => ({
            methodMaterialId,
            percentWw
          })
        )
      },
      error: null
    };
  }
});
