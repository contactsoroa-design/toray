import type { SupabaseClient } from "@supabase/supabase-js";

export type SupportedService = "OpenAI API" | "Anthropic API";

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
  service: SupportedService;
  amount_usd: number | string;
  billing_period: string | null;
  scanned_at: string;
  created_at: string;
};

export function mapDbRowToBillingScan(row: BillingScanRow): BillingScan {
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
    .limit(25);

  if (error || !data) return [];

  return (data as BillingScanRow[]).map(mapDbRowToBillingScan);
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
    .slice(0, 25);
}

export function deriveDashboardFromHistory(
  history: BillingScan[],
  initialSpent: number,
  serviceDefaults: { name: string; amount: number }[],
): {
  serviceAmounts: Partial<Record<SupportedService, number>>;
  spent: number;
} {
  const serviceAmounts = history.reduce<
    Partial<Record<SupportedService, number>>
  >((amounts, scan) => {
    if (scan.service && Number.isFinite(scan.amountUsd)) {
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
