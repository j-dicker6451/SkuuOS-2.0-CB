/**
 * AGPLv3-safe plan gating — inferred from AGPL call sites (see billing-system.md).
 */
import {
  getCompanyPlanId,
  isCarbonOwnedCompany
} from "@carbon/auth/company.server";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import { CarbonEdition } from "@carbon/env";
import { Edition, normalizePlanId, redirect } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultUpgradeMessage,
  type Feature,
  type GateSpec,
  planMeetsRequirement,
  resolveRequirement
} from "./plan.ts";

export async function getPlan(
  _client: SupabaseClient<Database>,
  companyId: string
): Promise<string | null> {
  return getCompanyPlanId(companyId);
}

export async function companyHasFeature(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: GateSpec
): Promise<boolean> {
  if (CarbonEdition === Edition.Community) {
    return false;
  }
  if (CarbonEdition !== Edition.Cloud) {
    return true;
  }
  if (await isCarbonOwnedCompany(companyId)) {
    return true;
  }
  const planId = await getCompanyPlanId(companyId);
  const plan = normalizePlanId(planId);
  const requirement = resolveRequirement(spec);
  return planMeetsRequirement(plan, requirement);
}

export type RequireFeatureArgs = {
  request: Request;
  client: SupabaseClient<Database>;
  companyId: string;
  redirectTo: string;
  feature: Feature;
  message?: string;
};

export async function requireFeature(args: RequireFeatureArgs): Promise<void> {
  const allowed = await companyHasFeature(args.client, args.companyId, {
    feature: args.feature
  });
  if (allowed) return;
  throw redirect(
    args.redirectTo,
    await flash(args.request, {
      success: false,
      message:
        args.message ??
        defaultUpgradeMessage(resolveRequirement({ feature: args.feature }))
    })
  );
}

export async function hasIntegrationEarlyAccess(_args: {
  companyId: string;
  userId: string;
  email: string;
}): Promise<boolean> {
  return false;
}

/** @deprecated Use `companyHasFeature` / `requireFeature`. */
export async function companyHasPlan(
  client: SupabaseClient<Database>,
  companyId: string,
  spec: GateSpec
): Promise<boolean> {
  return companyHasFeature(client, companyId, spec);
}

export type RequirePlanArgs = RequireFeatureArgs;

/** @deprecated Use `requireFeature`. */
export async function requirePlan(args: RequirePlanArgs): Promise<void> {
  return requireFeature(args);
}

export default function PlanServerStub() {
  return null;
}
