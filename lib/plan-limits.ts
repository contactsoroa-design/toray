export const FREE_TOOL_LIMIT = 3;
/** Free monthly budget ceiling in USD. Pro has no cap. */
export const FREE_BUDGET_CAP = 400;

export const FOUNDING_PLAN_LABEL = "ToRay Pro";
export const FOUNDING_PRICE_LABEL = "$12/mo";
export const FOUNDING_CTA_LABEL = "Upgrade to ToRay Pro — $12/mo";

export function canTrackMoreTools(
  isFounding: boolean,
  trackedCount: number,
): boolean {
  return isFounding || trackedCount < FREE_TOOL_LIMIT;
}

/** True when saving would introduce a new tracked tool beyond the free limit. */
export function wouldExceedFreeToolLimit(
  isFounding: boolean,
  trackedCount: number,
  serviceName: string,
  existingAmounts: Record<string, number>,
): boolean {
  if (isFounding) return false;
  if (existingAmounts[serviceName] !== undefined) return false;
  return trackedCount >= FREE_TOOL_LIMIT;
}

/** Budget UI is available on Free (capped) and Pro (unlimited). */
export function canUseBudget(isFounding: boolean): boolean {
  void isFounding;
  return true;
}

export function maxBudgetForPlan(isFounding: boolean): number | null {
  return isFounding ? null : FREE_BUDGET_CAP;
}

export function clampBudgetForPlan(
  isFounding: boolean,
  budget: number | null,
): number | null {
  if (budget == null || !Number.isFinite(budget) || budget <= 0) return null;
  const rounded = Math.round(budget * 100) / 100;
  const max = maxBudgetForPlan(isFounding);
  if (max == null) return rounded;
  return Math.min(rounded, max);
}

export function budgetExceedsFreeCap(
  isFounding: boolean,
  budget: number,
): boolean {
  return !isFounding && budget > FREE_BUDGET_CAP;
}

export function canExportCsv(isFounding: boolean): boolean {
  return isFounding;
}

/** Custom tool names (add / edit / delete) are Pro-only. Free uses presets. */
export function canManageCustomTools(isFounding: boolean): boolean {
  return isFounding;
}

export function canSeeFullOutlook(isFounding: boolean): boolean {
  return isFounding;
}

export function canSeeStackPulse(isFounding: boolean): boolean {
  return isFounding;
}

export function freeToolLimitMessage(trackedCount: number): string {
  return `Free tracks up to ${FREE_TOOL_LIMIT} tools (${trackedCount}/${FREE_TOOL_LIMIT}). Unlock unlimited tools with ToRay Pro — $12/mo.`;
}

export function foundingUpgradeHint(feature: string): string {
  return `${feature} unlocks with ToRay Pro — $12/mo.`;
}

export function freeBudgetCapMessage(): string {
  return `Free budgets top out at $${FREE_BUDGET_CAP}/mo. Unlimited budgets unlock with ToRay Pro — $12/mo.`;
}
