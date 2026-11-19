/**
 * AGPLv3-safe plan gating — inferred from AGPL call sites (see billing-system.md).
 * Upstream Enterprise `plan.ts` was excluded; this module keeps client gates working.
 */
import { Plan, type Plan as PlanEnum } from "@carbon/utils";

const PAID: PlanEnum[] = [Plan.Business, Plan.Partner];

export const FEATURE_PLANS = {
  API_KEYS: PAID,
  WEBHOOKS: PAID,
  MCP: PAID,
  INTEGRATIONS: PAID,
  SALES_RULES: PAID,
  ITEM_RULES: PAID,
  STORAGE_RULES: PAID,
  AUDIT_LOG: PAID,
  EMAIL_NOTIFICATIONS: PAID,
  CUSTOMER_PORTALS: PAID,
  AI_AGENT: PAID,
  WORKFLOWS: PAID,
  FORECAST: PAID,
  TWO_FACTOR: PAID,
  PERMISSIONS: PAID,
  APPROVAL_RULES: PAID,
  BACKUPS: PAID,
  GOVERNMENT_CONTRACTING: PAID,
  PLANNING_GROUPS: PAID,
  PROJECT_REVENUE: PAID
} as const;

export type Feature = keyof typeof FEATURE_PLANS;

export type GateSpec = { feature: Feature } | { plan: PlanEnum | PlanEnum[] };

/** Integrations installable on Starter without the INTEGRATIONS feature. */
const INTEGRATION_WHITELIST = new Set<string>(["email"]);

export function isIntegrationWhitelisted(integrationId: string): boolean {
  return INTEGRATION_WHITELIST.has(integrationId);
}

export function isIntegrationComingSoon(
  integration: { internalOnly?: boolean } | undefined,
  options: { edition: string; email: string; hasEarlyAccess: boolean }
): boolean {
  if (!integration?.internalOnly) return false;
  if (options.hasEarlyAccess) return false;
  return true;
}

export function resolveRequirement(spec: GateSpec): PlanEnum[] {
  if ("feature" in spec && spec.feature) {
    return [...(FEATURE_PLANS[spec.feature] ?? [])];
  }
  if ("plan" in spec && spec.plan !== undefined) {
    return Array.isArray(spec.plan) ? [...spec.plan] : [spec.plan];
  }
  return [];
}

export function planMeetsRequirement(
  plan: PlanEnum,
  requirement: PlanEnum[]
): boolean {
  return requirement.length === 0 || requirement.includes(plan);
}

export function defaultUpgradeMessage(requirement: PlanEnum[]): string {
  if (requirement.length === 0) {
    return "This feature is not available on your current plan.";
  }
  const label =
    requirement.length === 1
      ? requirement[0]
      : `${requirement.slice(0, -1).join(", ")} or ${requirement.at(-1)}`;
  return `Upgrade to ${label} to use this feature.`;
}

export default function PlanStub() {
  return null;
}
