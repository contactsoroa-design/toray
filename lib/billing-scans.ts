import type { SupabaseClient } from "@supabase/supabase-js";

/** Built-in catalog. Custom names are Pro-only (managed in the dashboard). */
export const PRESET_SERVICES = [
  "OpenAI API",
  "Anthropic API",
  "ChatGPT Plus",
  "Claude Pro",
  "Cursor Pro",
  "Gemini API",
  "Grok",
  "Midjourney",
  "Runway",
  "ElevenLabs",
  "GitHub Copilot",
  "Perplexity Pro",
] as const;

/** @deprecated Use PRESET_SERVICES — kept for older imports */
export const SUPPORTED_SERVICES = PRESET_SERVICES;

export type PresetService = (typeof PRESET_SERVICES)[number];
/** Any tool name the user tracks (preset or custom). */
export type ServiceName = string;
/** @deprecated Use ServiceName */
export type SupportedService = ServiceName;

export type BillingScan = {
  id: string;
  service: ServiceName;
  amountUsd: number;
  billingPeriod: string | null;
  confidence: "high" | "medium" | "low";
  scannedAt: string;
};

type BillingScanRow = {
  id: string;
  user_id: string;
  service: string;
  amount_usd: number | string;
  billing_period: string | null;
  scanned_at: string;
  created_at: string;
};

export function isValidServiceName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

/** Services the user removed locally — must not come back from cloud merge. */
export const REMOVED_SERVICES_KEY = "toray-billing-removed-services";

export function readRemovedServices(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(REMOVED_SERVICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function markServiceRemoved(service: ServiceName) {
  if (typeof window === "undefined") return;
  const target = service.trim().toLowerCase();
  if (!target) return;
  const next = Array.from(new Set([...readRemovedServices(), target]));
  window.localStorage.setItem(REMOVED_SERVICES_KEY, JSON.stringify(next));
}

export function clearServiceRemoved(service: ServiceName) {
  if (typeof window === "undefined") return;
  const target = service.trim().toLowerCase();
  const next = readRemovedServices().filter((name) => name !== target);
  if (next.length === 0) {
    window.localStorage.removeItem(REMOVED_SERVICES_KEY);
  } else {
    window.localStorage.setItem(REMOVED_SERVICES_KEY, JSON.stringify(next));
  }
}

export function clearAllRemovedServices() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(REMOVED_SERVICES_KEY);
}

export function filterRemovedServices(
  history: BillingScan[],
  removed: string[] = readRemovedServices(),
): BillingScan[] {
  if (removed.length === 0) return history;
  const blocked = new Set(removed.map((name) => name.toLowerCase()));
  return history.filter(
    (scan) => !blocked.has(scan.service.trim().toLowerCase()),
  );
}

export function mapDbRowToBillingScan(row: BillingScanRow): BillingScan | null {
  if (!isValidServiceName(row.service)) return null;

  return {
    id: row.id,
    service: row.service.trim(),
    amountUsd: Number(row.amount_usd),
    billingPeriod: row.billing_period,
    confidence: "high",
    scannedAt: row.scanned_at,
  };
}

export async function fetchUserBillingScans(
  supabase: SupabaseClient,
): Promise<BillingScan[]> {
  const { data, error } = await supabase
    .from("billing_scans")
    .select("id, user_id, service, amount_usd, billing_period, scanned_at, created_at")
    .order("scanned_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return (data as BillingScanRow[])
    .map(mapDbRowToBillingScan)
    .filter((scan): scan is BillingScan => scan !== null);
}

export async function insertBillingScan(
  supabase: SupabaseClient,
  scan: BillingScan,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  // Keep one live row per service in the cloud for cleaner sync.
  await supabase
    .from("billing_scans")
    .delete()
    .eq("user_id", user.id)
    .eq("service", scan.service);

  const { error } = await supabase.from("billing_scans").insert({
    id: scan.id,
    user_id: user.id,
    service: scan.service,
    amount_usd: scan.amountUsd,
    billing_period: scan.billingPeriod,
    scanned_at: scan.scannedAt,
  });

  if (error) throw error;
}

export async function deleteBillingScansForService(
  supabase: SupabaseClient,
  service: ServiceName,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const target = service.trim().toLowerCase();

  // Exact match first (common path).
  const { error: exactError } = await supabase
    .from("billing_scans")
    .delete()
    .eq("user_id", user.id)
    .eq("service", service);
  if (exactError) throw exactError;

  // Also wipe any case/variant rows for this service name.
  const { data: rows, error: listError } = await supabase
    .from("billing_scans")
    .select("id, service")
    .eq("user_id", user.id);
  if (listError) throw listError;

  const ids = (rows ?? [])
    .filter((row) => String(row.service).trim().toLowerCase() === target)
    .map((row) => row.id as string);
  if (ids.length === 0) return;

  const { error: bulkError } = await supabase
    .from("billing_scans")
    .delete()
    .eq("user_id", user.id)
    .in("id", ids);
  if (bulkError) throw bulkError;
}

export function mergeBillingScanHistories(
  local: BillingScan[],
  remote: BillingScan[],
  removedServices: string[] = readRemovedServices(),
): BillingScan[] {
  const byId = new Map<string, BillingScan>();

  for (const scan of filterRemovedServices(
    [...local, ...remote],
    removedServices,
  )) {
    byId.set(scan.id, scan);
  }

  return [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime(),
    )
    .slice(0, 50);
}

export function deriveDashboardFromHistory(
  history: BillingScan[],
  initialSpent: number,
  serviceDefaults: { name: string; amount: number }[],
): {
  serviceAmounts: Record<string, number>;
  spent: number;
} {
  const serviceAmounts = history.reduce<Record<string, number>>(
    (amounts, scan) => {
      if (
        scan.service &&
        Number.isFinite(scan.amountUsd) &&
        amounts[scan.service] === undefined
      ) {
        amounts[scan.service] = scan.amountUsd;
      }
      return amounts;
    },
    {},
  );

  const spent = Object.entries(serviceAmounts).reduce(
    (total, [serviceName, amount]) => {
      const defaultAmount =
        serviceDefaults.find((service) => service.name === serviceName)
          ?.amount ?? 0;
      return total - defaultAmount + amount;
    },
    initialSpent,
  );

  return { serviceAmounts, spent };
}

export function applyHistoryToDashboard(
  history: BillingScan[],
  initialSpent: number,
  serviceDefaults: { name: string; amount: number }[],
): {
  scanHistory: BillingScan[];
  serviceAmounts: Record<string, number>;
  spent: number;
} {
  const { serviceAmounts, spent } = deriveDashboardFromHistory(
    history,
    initialSpent,
    serviceDefaults,
  );

  return { scanHistory: history, serviceAmounts, spent };
}
