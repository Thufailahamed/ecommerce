import { PLANS, type Plan, type PlanId } from "@convertflow/contracts";

export { PLANS };
export type { Plan, PlanId };

/** A subscription that is not paid up falls back to free-tier limits. */
export function effectivePlan(plan: PlanId, status: string): Plan {
  return status === "active" || status === "trialing" ? PLANS[plan] : PLANS.free;
}
