import type { SupabaseClient } from "@supabase/supabase-js";

export const BUDGET_KEY = "toray-monthly-budget";
export const HIDDEN_TOOLS_KEY = "toray-hidden-tools";
export const CUSTOM_TOOLS_KEY = "toray-custom-tools";
export const FOUNDING_KEY = "toray-founding-member";
export const CATALOG_SEEDED_KEY = "toray-catalog-seeded";

/** Presets hidden on first visit so the dashboard starts focused. */
export const DEFAULT_HIDDEN_PRESETS = [
  "Claude Pro",
  "Midjourney",
  "Runway",
  "ElevenLabs",
  "GitHub Copilot",
  "Perplexity Pro",
] as const;

export type CustomToolPref = {
  name: string;
  isUsageBased: boolean;
  suggestedAmount: number;
};

export type DashboardPrefs = {
  budget: number | null;
  hiddenTools: string[];
  customTools: CustomToolPref[];
  isFounding: boolean;
};

export function readLocalPrefs(): DashboardPrefs {
  if (typeof window === "undefined") {
    return {
      budget: null,
      hiddenTools: [],
      customTools: [],
      isFounding: false,
    };
  }

  return {
    budget: readBudget(),
    hiddenTools: readHiddenToolsWithStarterDefaults(),
    customTools: readCustomTools(),
    isFounding: window.localStorage.getItem(FOUNDING_KEY) === "1",
  };
}

/** First visit only: seed a compact catalog. Never overwrite an existing preference. */
function readHiddenToolsWithStarterDefaults(): string[] {
  if (window.localStorage.getItem(CATALOG_SEEDED_KEY) === "1") {
    return readJsonArray(HIDDEN_TOOLS_KEY);
  }

  const existingRaw = window.localStorage.getItem(HIDDEN_TOOLS_KEY);
  if (existingRaw !== null) {
    window.localStorage.setItem(CATALOG_SEEDED_KEY, "1");
    return readJsonArray(HIDDEN_TOOLS_KEY);
  }

  const starter = [...DEFAULT_HIDDEN_PRESETS];
  window.localStorage.setItem(HIDDEN_TOOLS_KEY, JSON.stringify(starter));
  window.localStorage.setItem(CATALOG_SEEDED_KEY, "1");
  return starter;
}

export function readBudget(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(BUDGET_KEY);
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function writeBudget(value: number | null) {
  if (value == null) window.localStorage.removeItem(BUDGET_KEY);
  else window.localStorage.setItem(BUDGET_KEY, String(value));
}

export function writeHiddenTools(names: string[]) {
  window.localStorage.setItem(HIDDEN_TOOLS_KEY, JSON.stringify(names));
}

export function writeCustomTools(tools: CustomToolPref[]) {
  window.localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(tools));
}

export function writeFounding(isFounding: boolean) {
  if (isFounding) window.localStorage.setItem(FOUNDING_KEY, "1");
  else window.localStorage.removeItem(FOUNDING_KEY);
}

/** Wipe account-linked prefs from this browser after sign-out. */
export function clearLocalAccountData(): {
  hiddenTools: string[];
} {
  if (typeof window === "undefined") {
    return { hiddenTools: [...DEFAULT_HIDDEN_PRESETS] };
  }

  window.localStorage.removeItem(BUDGET_KEY);
  window.localStorage.removeItem(CUSTOM_TOOLS_KEY);
  window.localStorage.removeItem(FOUNDING_KEY);
  window.localStorage.removeItem(HIDDEN_TOOLS_KEY);
  window.localStorage.removeItem(CATALOG_SEEDED_KEY);

  const hiddenTools = [...DEFAULT_HIDDEN_PRESETS];
  window.localStorage.setItem(HIDDEN_TOOLS_KEY, JSON.stringify(hiddenTools));
  window.localStorage.setItem(CATALOG_SEEDED_KEY, "1");
  return { hiddenTools };
}

function readJsonArray(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function readCustomTools(): CustomToolPref[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_TOOLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CustomToolPref =>
        !!item &&
        typeof item === "object" &&
        typeof (item as CustomToolPref).name === "string" &&
        typeof (item as CustomToolPref).isUsageBased === "boolean" &&
        typeof (item as CustomToolPref).suggestedAmount === "number",
    );
  } catch {
    return [];
  }
}

type PrefsMeta = {
  toray_budget?: number | null;
  toray_hidden_tools?: string[];
  toray_custom_tools?: CustomToolPref[];
  toray_founding?: boolean;
};

/** Merge remote user_metadata prefs over local (remote wins on conflict). */
export function mergePrefs(
  local: DashboardPrefs,
  meta: PrefsMeta | undefined,
): DashboardPrefs {
  if (!meta) return local;

  return {
    budget:
      meta.toray_budget === undefined
        ? local.budget
        : meta.toray_budget == null || meta.toray_budget <= 0
          ? null
          : meta.toray_budget,
    hiddenTools: Array.isArray(meta.toray_hidden_tools)
      ? meta.toray_hidden_tools
      : local.hiddenTools,
    customTools: Array.isArray(meta.toray_custom_tools)
      ? meta.toray_custom_tools
      : local.customTools,
    isFounding: meta.toray_founding === true || local.isFounding,
  };
}

export async function persistPrefsToCloud(
  supabase: SupabaseClient,
  prefs: DashboardPrefs,
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.auth.updateUser({
    data: {
      toray_budget: prefs.budget,
      toray_hidden_tools: prefs.hiddenTools,
      toray_custom_tools: prefs.customTools,
      toray_founding: prefs.isFounding,
    } satisfies PrefsMeta,
  });
}

export function downloadSpendCsv(args: {
  amounts: Record<string, number>;
  history: {
    service: string;
    amountUsd: number;
    billingPeriod: string | null;
    scannedAt: string;
  }[];
  budget: number | null;
  projected: number;
}) {
  const totalSpent = Object.values(args.amounts)
    .reduce((a, b) => a + b, 0)
    .toFixed(2);
  const budgetCell =
    args.budget == null ? "" : args.budget.toFixed(2);

  const lines = [
    "section,service,amount_usd,billing_period,scanned_at",
    ["summary", "Total spent", totalSpent, "", ""].join(","),
    ["summary", "Month-end outlook", args.projected.toFixed(2), "", ""].join(
      ",",
    ),
    ["summary", "Budget", budgetCell, "", ""].join(","),
    ...Object.entries(args.amounts).map(([service, amount]) =>
      ["tool", csvEscape(service), amount.toFixed(2), "", ""].join(","),
    ),
    ...args.history.map((row) =>
      [
        "update",
        csvEscape(row.service),
        row.amountUsd.toFixed(2),
        csvEscape(row.billingPeriod ?? ""),
        row.scannedAt,
      ].join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `toray-spend-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
