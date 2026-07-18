export const FREE_TOOL_LIMIT = 3;

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

export function canUseBudget(isFounding: boolean): boolean {
  return isFounding;
}

export function canExportCsv(isFounding: boolean): boolean {
  return isFounding;
}

export function canSeeFullOutlook(isFounding: boolean): boolean {
  return isFounding;
}

export function freeToolLimitMessage(trackedCount: number): string {
  return `Free tracks up to ${FREE_TOOL_LIMIT} tools (${trackedCount}/${FREE_TOOL_LIMIT}). Unlock unlimited tools with ToRay Pro — $12/mo.`;
}

export function foundingUpgradeHint(feature: string): string {
  return `${feature} unlocks with ToRay Pro — $12/mo.`;
}
