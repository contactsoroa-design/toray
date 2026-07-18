import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPPORTED_SERVICES = [
  "OpenAI API",
  "Anthropic API",
  "ChatGPT Plus",
  "Claude Pro",
  "Cursor Pro",
  "Midjourney",
  "GitHub Copilot",
  "Perplexity Pro",
] as const;

export type SupportedService = (typeof SUPPORTED_SERVICES)[number];

export type BillingScan = {
  id: string;
  service: SupportedService;
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

function isSupportedService(value: string): value is SupportedService {
  return (SUPPORTED_SERVICES as readonly string[]).includes(value);
}

export function mapDbRowToBillingScan(row: BillingScanRow): BillingScan | null {
  if (!isSupportedService(row.service)) return null;

  return {
    id: row.id,
    service: row.service,
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

export function mergeBillingScanHistories(
  local: BillingScan[],
  remote: BillingScan[],
): BillingScan[] {
  const byId = new Map<string, BillingScan>();

  for (const scan of [...local, ...remote]) {
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
  serviceAmounts: Partial<Record<SupportedService, number>>;
  spent: number;
} {
  // History is newest-first: keep the first amount seen per service.
  const serviceAmounts = history.reduce<
    Partial<Record<SupportedService, number>>
  >((amounts, scan) => {
    if (
      scan.service &&
      Number.isFinite(scan.amountUsd) &&
      amounts[scan.service] === undefined
    ) {
      amounts[scan.service] = scan.amountUsd;
    }
    return amounts;
  }, {});

  const spent = (
    Object.entries(serviceAmounts) as [SupportedService, number][]
  ).reduce((total, [serviceName, amount]) => {
    const defaultAmount =
      serviceDefaults.find((service) => service.name === serviceName)?.amount ??
      0;
    return total - defaultAmount + amount;
  }, initialSpent);

  return { serviceAmounts, spent };
}

export function applyHistoryToDashboard(
  history: BillingScan[],
  initialSpent: number,
  serviceDefaults: { name: string; amount: number }[],
): {
  scanHistory: BillingScan[];
  serviceAmounts: Partial<Record<SupportedService, number>>;
  spent: number;
} {
  const { serviceAmounts, spent } = deriveDashboardFromHistory(
    history,
    initialSpent,
    serviceDefaults,
  );

  return { scanHistory: history, serviceAmounts, spent };
}
