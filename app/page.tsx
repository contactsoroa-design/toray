"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Download,
  EyeOff,
  LogOut,
  PencilLine,
  Plus,
  Radar,
  ScanLine,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import {
  applyHistoryToDashboard,
  deleteBillingScansForService,
  fetchUserBillingScans,
  insertBillingScan,
  isValidServiceName,
  mergeBillingScanHistories,
  PRESET_SERVICES,
  type BillingScan,
  type ServiceName,
} from "@/lib/billing-scans";
import {
  clearLocalAccountData,
  downloadSpendCsv,
  mergePrefs,
  persistPrefsToCloud,
  readLocalPrefs,
  writeBudget,
  writeCustomTools,
  writeFounding,
  writeHiddenTools,
  type CustomToolPref,
} from "@/lib/dashboard-prefs";
import {
  budgetExceedsFreeCap,
  canExportCsv,
  canSeeFullOutlook,
  canSeeStackPulse,
  canUseBudget,
  clampBudgetForPlan,
  FOUNDING_CTA_LABEL,
  FOUNDING_PLAN_LABEL,
  FREE_BUDGET_CAP,
  FREE_TOOL_LIMIT,
  freeBudgetCapMessage,
  freeToolLimitMessage,
  foundingUpgradeHint,
  wouldExceedFreeToolLimit,
} from "@/lib/plan-limits";
import {
  isVisionProvider,
  visionProviderToToolName,
} from "@/lib/vision-providers";
import { createClient } from "@/lib/supabase/client";

const INITIAL_SPENT = 0;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const SCAN_HISTORY_KEY = "toray-billing-scans";
const STRIPE_URL =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ??
  "https://buy.stripe.com/6oU14m0Lu92V2dL0dx9sk00";

function buildStripeHref(email: string | null) {
  const url = new URL(STRIPE_URL);
  url.searchParams.set("client_reference_id", "toray_founding");
  if (email) {
    url.searchParams.set("prefilled_email", email);
  }
  return url.toString();
}

type ScanStatus = "idle" | "scanning" | "success" | "error";

type ToolDef = {
  name: ServiceName;
  type: string;
  /** Prefill only — never shown as the user's spend until they save. */
  suggestedAmount: number;
  isUsageBased: boolean;
  accent: string;
  origin: "preset" | "custom";
};

const PRESET_META: Record<
  (typeof PRESET_SERVICES)[number],
  Omit<ToolDef, "name" | "origin">
> = {
  "OpenAI API": {
    type: "Usage-based",
    suggestedAmount: 50,
    isUsageBased: true,
    accent: "bg-clay/20 text-clay",
  },
  "Anthropic API": {
    type: "Usage-based",
    suggestedAmount: 40,
    isUsageBased: true,
    accent: "bg-blush/20 text-blush",
  },
  "ChatGPT Plus": {
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-mint/20 text-mint",
  },
  "Claude Pro": {
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-blush/20 text-blush",
  },
  "Cursor Pro": {
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-sage/25 text-sage-soft",
  },
  "Gemini API": {
    type: "Usage-based",
    suggestedAmount: 40,
    isUsageBased: true,
    accent: "bg-mint/20 text-mint",
  },
  Grok: {
    type: "Usage-based",
    suggestedAmount: 30,
    isUsageBased: true,
    accent: "bg-bone/10 text-bone-muted",
  },
  Midjourney: {
    type: "Subscription",
    suggestedAmount: 30,
    isUsageBased: false,
    accent: "bg-moss/25 text-sage-soft",
  },
  Runway: {
    type: "Subscription",
    suggestedAmount: 35,
    isUsageBased: false,
    accent: "bg-clay/20 text-clay",
  },
  ElevenLabs: {
    type: "Usage-based",
    suggestedAmount: 22,
    isUsageBased: true,
    accent: "bg-blush/20 text-blush",
  },
  "GitHub Copilot": {
    type: "Subscription",
    suggestedAmount: 10,
    isUsageBased: false,
    accent: "bg-bone/10 text-bone-muted",
  },
  "Perplexity Pro": {
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-clay/15 text-clay",
  },
};

const PRESET_TOOLS: ToolDef[] = PRESET_SERVICES.map((name) => ({
  name,
  origin: "preset" as const,
  ...PRESET_META[name],
}));

const CUSTOM_ACCENTS = [
  "bg-sage/25 text-sage-soft",
  "bg-clay/20 text-clay",
  "bg-mint/20 text-mint",
  "bg-blush/20 text-blush",
];

function toolFromCustom(pref: CustomToolPref, index: number): ToolDef {
  return {
    name: pref.name,
    type: pref.isUsageBased ? "Usage-based" : "Subscription",
    suggestedAmount: pref.suggestedAmount,
    isUsageBased: pref.isUsageBased,
    accent: CUSTOM_ACCENTS[index % CUSTOM_ACCENTS.length],
    origin: "custom",
  };
}

function endOfMonthLabel(date = new Date()) {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Usage-based spend is paced to month-end; fixed subscriptions stay flat. */
function computeProjectedSpend(
  amounts: Record<string, number>,
  catalog: ToolDef[],
  date = new Date(),
) {
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const pace = day > 0 ? daysInMonth / day : 1;
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));

  let fixed = 0;
  let usage = 0;
  for (const [name, amount] of Object.entries(amounts)) {
    const tool = byName.get(name);
    if (tool?.isUsageBased ?? true) usage += amount;
    else fixed += amount;
  }

  return Math.round((fixed + usage * pace) * 100) / 100;
}

const SCAN_STEPS = [
  "Uploading securely…",
  "Reading your billing screen…",
  "Extracting your USD total…",
];

const PRO_FEATURES = [
  {
    icon: Plus,
    text: `Unlimited tools (Free caps at ${FREE_TOOL_LIMIT})`,
  },
  {
    icon: ScanLine,
    text: "Gemini & Grok Vision — AI Studio / xAI billing screenshots",
  },
  {
    icon: Radar,
    text: "Month-end outlook + Stack Pulse (burn rate, top tool, pace)",
  },
  {
    icon: Shield,
    text: `Unlimited budget (Free caps at $${FREE_BUDGET_CAP}/mo) + CSV export`,
  },
];

type StackPulse = {
  dailyBurn: number;
  topTool: string | null;
  topShare: number;
  daysUntilBudget: number | null;
  paceLabel: string;
};

function computeStackPulse(
  amounts: Record<string, number>,
  spent: number,
  projected: number,
  budget: number | null,
): StackPulse {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dailyBurn =
    dayOfMonth > 0 ? Math.round((spent / dayOfMonth) * 100) / 100 : 0;

  const ranked = Object.entries(amounts).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, value]) => sum + value, 0);
  const topTool = ranked[0]?.[0] ?? null;
  const topShare =
    total > 0 && ranked[0]
      ? Math.round((ranked[0][1] / total) * 100)
      : 0;

  let daysUntilBudget: number | null = null;
  let paceLabel = "Add spend to see your pace.";
  if (budget != null && budget > 0 && dailyBurn > 0) {
    const daysToHit = Math.ceil(budget / dailyBurn);
    daysUntilBudget = daysToHit;
    if (projected > budget) {
      paceLabel = `Outlook overshoots by $${Math.round(projected - budget)} — cut or raise budget.`;
    } else if (daysToHit <= daysInMonth) {
      paceLabel = `At today's burn, you hit $${budget} around day ${Math.min(daysToHit, daysInMonth)}.`;
    } else {
      paceLabel = `On pace to finish under $${budget} this month.`;
    }
  } else if (dailyBurn > 0) {
    paceLabel = `Burning ~$${dailyBurn.toFixed(0)}/day so far this month.`;
  }

  return { dailyBurn, topTool, topShare, daysUntilBudget, paceLabel };
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function useAnimatedNumber(target: number, durationMs = 900) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const value = from + (target - from) * easeOutCubic(progress);
      setDisplay(value);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return display;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function WaitlistSuccess({
  compact = false,
  message = "Check your inbox for a magic link to sign in.",
}: {
  compact?: boolean;
  message?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-mint/30 bg-gradient-to-br from-mint/15 to-sage/10 text-center ${
        compact ? "px-4 py-3" : "px-6 py-5"
      }`}
      role="status"
    >
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-mint/20">
        <Check className="h-5 w-5 text-mint" strokeWidth={2.5} />
      </div>
      <p
        className={`mt-3 font-serif text-bone ${compact ? "text-base" : "text-lg"}`}
      >
        Thank you!
      </p>
      <p className={`mt-1 text-bone-muted ${compact ? "text-xs" : "text-sm"}`}>
        {message}
      </p>
    </div>
  );
}

function WaitlistForm({
  email,
  onEmailChange,
  submitted,
  isSubmitting,
  onSubmit,
  variant = "default",
  id,
  submitLabel = "Email me a sign-in link",
  submittingLabel = "Sending link…",
  successMessage,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  submitted: boolean;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  variant?: "default" | "compact" | "mobile";
  id?: string;
  submitLabel?: string;
  submittingLabel?: string;
  successMessage?: string;
}) {
  if (submitted) {
    return (
      <WaitlistSuccess
        compact={variant === "compact"}
        message={successMessage}
      />
    );
  }

  const inputClass =
    variant === "mobile"
      ? "w-full rounded-full border border-clay/35 bg-background/70 px-4 py-3.5 text-base text-bone placeholder:text-bone-muted/60 outline-none transition focus:border-clay focus:ring-2 focus:ring-clay/25"
      : "w-full rounded-full border border-hairline bg-background/60 px-4 py-3 text-sm text-bone placeholder:text-bone-muted/60 outline-none transition focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20";

  const buttonClass =
    variant === "mobile"
      ? "w-full shrink-0 rounded-full bg-clay px-6 py-3.5 text-base font-semibold text-background transition duration-180 hover:bg-clay/90 sm:w-auto"
      : variant === "compact"
        ? "shrink-0 rounded-full bg-sage px-4 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow"
        : "shrink-0 rounded-full bg-sage px-6 py-3 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow";

  const layoutClass =
    variant === "compact"
      ? "flex flex-col gap-2 sm:flex-row sm:items-center"
      : variant === "mobile"
        ? "flex flex-col gap-3 sm:flex-row sm:items-stretch"
        : "flex flex-col gap-3 sm:flex-row sm:items-center";

  return (
    <form id={id} onSubmit={onSubmit} className={layoutClass}>
      <input
        type="email"
        required
        name="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="you@company.com"
        aria-label="Email address"
        autoComplete="email"
        inputMode="email"
        className={inputClass}
      />
      <button
        type="submit"
        disabled={isSubmitting}
        className={`${buttonClass} disabled:cursor-wait disabled:opacity-60`}
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}

function MobileDesktopBridgeBanner({
  email,
  onEmailChange,
  submitted,
  isSubmitting,
  onSubmit,
  error,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  submitted: boolean;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  error: string | null;
}) {
  return (
    <section
      aria-labelledby="mobile-bridge-heading"
      className="md:hidden"
    >
      <div className="rounded-[24px] border border-hairline bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-sage-soft">
              Continue on desktop
            </p>
            <h2
              id="mobile-bridge-heading"
              className="mt-1.5 font-serif text-xl leading-snug tracking-[-0.02em] text-bone"
            >
              Email yourself a sign-in link
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-bone-muted">
              Sign in backs up this device&apos;s totals to your email — free.
              It does not unlock ToRay Pro features.
            </p>
          </div>

          <div className="w-full">
            <WaitlistForm
              id="mobile-sign-in"
              email={email}
              onEmailChange={onEmailChange}
              submitted={submitted}
              isSubmitting={isSubmitting}
              onSubmit={onSubmit}
              variant="mobile"
              submitLabel="Email me a link"
              submittingLabel="Sending link…"
              successMessage="Check your email for a magic link to sign in."
            />
            {error && (
              <p className="mt-2 text-center text-sm text-warning">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SignInModal({
  email,
  onEmailChange,
  submitted,
  isSubmitting,
  onSubmit,
  error,
  onClose,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  submitted: boolean;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-title"
    >
      <div className="w-full max-w-md rounded-[28px] border border-hairline bg-surface p-6 shadow-2xl md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Free backup</Eyebrow>
            <h2
              id="sign-in-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              Sign in with email
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              Magic link keeps your tools, amounts, and budget on this account
              if you clear the browser. Free limits stay the same — ToRay Pro is
              a separate upgrade.
            </p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-bone-muted">
              <li className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint" />
                Cloud backup of tracked tools &amp; budget
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint" />
                Same Free caps ({FREE_TOOL_LIMIT} tools · ${FREE_BUDGET_CAP} budget)
              </li>
              <li className="flex gap-2">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bone-muted/70" />
                Does not unlock Outlook, Stack Pulse, or Gemini/Grok Vision
              </li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-bone-muted transition hover:bg-bone/10 hover:text-bone"
            aria-label="Close sign in"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6">
          <WaitlistForm
            id="sign-in-form"
            email={email}
            onEmailChange={onEmailChange}
            submitted={submitted}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
            variant="default"
            submitLabel="Email me a sign-in link"
            submittingLabel="Sending link…"
            successMessage="Check your email for a magic link to sign in."
          />
          {error && (
            <p className="mt-3 text-sm text-warning">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
      <defs>
        <linearGradient id="toray-mark" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3b5b4c" />
          <stop offset="55%" stopColor="#6f9e7c" />
          <stop offset="100%" stopColor="#d4a574" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15.5" fill="url(#toray-mark)" />
      <path d="M10 21 L22 11" stroke="#F5F0E8" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 15.5 L16.5 11" stroke="#F5F0E8" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <path d="M15.5 21 L22 15.5" stroke="#F5F0E8" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

function Meter({ ratio }: { ratio: number }) {
  const SEGMENTS = 28;
  const filled = Math.round((Math.min(ratio, 100) / 100) * SEGMENTS);

  return (
    <div className="flex h-5 items-end gap-[3px]">
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const isFilled = i < filled;
        const t = i / (SEGMENTS - 1);
        let fillClass = "bg-sage-soft";
        if (t >= 0.85) fillClass = "bg-danger";
        else if (t >= 0.7) fillClass = "bg-clay";
        else if (t >= 0.4) fillClass = "bg-mint";
        else fillClass = "bg-sage-glow";

        return (
          <span
            key={i}
            className={`w-[5px] rounded-[1.5px] transition-colors duration-500 ${
              isFilled ? `h-full ${fillClass}` : "h-3 bg-bone/[0.08]"
            }`}
          />
        );
      })}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-sage-soft">
      {children}
    </span>
  );
}

function ScanLoader({ stepIndex }: { stepIndex: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-sage-soft/25" />
        <span className="absolute inset-1 animate-spin rounded-full border-2 border-transparent border-t-sage-soft border-r-sage-soft/30" />
        <span className="absolute inset-3 animate-pulse rounded-full bg-sage/30" />
        <ScanLine className="relative h-6 w-6 text-sage-soft" strokeWidth={1.5} />
      </div>
      <p className="mt-5 font-serif text-xl text-bone">Reading your usage…</p>
      <p className="mt-2 text-[13px] text-bone-muted">{SCAN_STEPS[stepIndex]}</p>
      <div className="mt-6 flex gap-2">
        {SCAN_STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              i <= stepIndex ? "bg-sage-soft" : "bg-bone/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ManualCorrectionModal({
  amount,
  period,
  service,
  serviceOptions,
  isCustomMode,
  customName,
  isUsageBased,
  onAmountChange,
  onPeriodChange,
  onServiceChange,
  onCustomModeChange,
  onCustomNameChange,
  onUsageBasedChange,
  onClose,
  onSave,
  onClear,
  canClear,
  onDeleteCustom,
  canDeleteCustom,
  error,
}: {
  amount: string;
  period: string;
  service: ServiceName;
  serviceOptions: ServiceName[];
  isCustomMode: boolean;
  customName: string;
  isUsageBased: boolean;
  onAmountChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onServiceChange: (value: ServiceName) => void;
  onCustomModeChange: (value: boolean) => void;
  onCustomNameChange: (value: string) => void;
  onUsageBasedChange: (value: boolean) => void;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClear?: () => void;
  canClear?: boolean;
  onDeleteCustom?: () => void;
  canDeleteCustom?: boolean;
  error: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manual-correction-title"
    >
      <form
        noValidate
        onSubmit={onSave}
        className="w-full max-w-md rounded-[28px] border border-hairline bg-surface p-6 shadow-2xl md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Track a tool</Eyebrow>
            <h2
              id="manual-correction-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              Set the amount yourself
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              Pick a preset or add any tool — Gemini, Grok, Runway, Notion AI,
              whatever you actually pay for.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-bone-muted transition hover:bg-bone/10 hover:text-bone"
            aria-label="Close manual correction"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <div className="grid gap-1.5 text-sm text-bone-muted">
            <span>Service</span>
            {!isCustomMode ? (
              <>
                <select
                  value={service}
                  onChange={(event) => onServiceChange(event.target.value)}
                  className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
                >
                  {serviceOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onCustomModeChange(true)}
                  className="mt-1 justify-self-start text-[13px] text-sage-soft underline-offset-4 hover:underline"
                >
                  + Add a custom tool
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={customName}
                  onChange={(event) => onCustomNameChange(event.target.value)}
                  placeholder="e.g. Notion AI, v0, Suno"
                  maxLength={64}
                  className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition placeholder:text-bone-muted/50 focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => onCustomModeChange(false)}
                  className="mt-1 justify-self-start text-[13px] text-sage-soft underline-offset-4 hover:underline"
                >
                  Back to presets
                </button>
              </>
            )}
          </div>

          <fieldset className="grid gap-2 text-sm text-bone-muted">
            <legend>Billing type</legend>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onUsageBasedChange(false)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  !isUsageBased
                    ? "bg-sage text-bone"
                    : "border border-hairline text-bone-muted hover:text-bone"
                }`}
              >
                Subscription
              </button>
              <button
                type="button"
                onClick={() => onUsageBasedChange(true)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  isUsageBased
                    ? "bg-sage text-bone"
                    : "border border-hairline text-bone-muted hover:text-bone"
                }`}
              >
                Usage-based
              </button>
            </div>
          </fieldset>

          <label className="grid gap-1.5 text-sm text-bone-muted">
            Current-period total (USD)
            <div className="flex rounded-xl border border-hairline bg-background transition focus-within:border-sage-soft/60 focus-within:ring-2 focus:ring-sage/20">
              <span className="flex items-center pl-3 text-bone-muted">$</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(event) => onAmountChange(event.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent px-2 py-2.5 text-bone outline-none placeholder:text-bone-muted/50"
              />
            </div>
          </label>

          <label className="grid gap-1.5 text-sm text-bone-muted">
            Billing period <span className="text-bone-muted/60">(optional)</span>
            <input
              type="text"
              value={period}
              onChange={(event) => onPeriodChange(event.target.value)}
              placeholder="e.g. Jul 1 – Jul 31, 2026"
              className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition placeholder:text-bone-muted/50 focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
            />
          </label>
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-5 py-2.5 text-sm font-medium text-bone-muted transition hover:text-bone"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition hover:bg-sage-glow"
            >
              <Check className="h-4 w-4" />
              Save amount
            </button>
          </div>
          {(canClear && onClear) || (canDeleteCustom && onDeleteCustom) ? (
            <div className="flex flex-col items-center gap-2">
              {canClear && onClear && (
                <button
                  type="button"
                  onClick={onClear}
                  className="inline-flex items-center justify-center gap-1.5 text-[13px] text-warning underline-offset-4 transition hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove from this month&apos;s total
                </button>
              )}
              {canDeleteCustom && onDeleteCustom && (
                <button
                  type="button"
                  onClick={onDeleteCustom}
                  className="inline-flex items-center justify-center gap-1.5 text-[13px] text-bone-muted underline-offset-4 transition hover:text-warning hover:underline"
                >
                  Delete custom tool
                </button>
              )}
            </div>
          ) : null}
        </div>
        {error && <p className="mt-3 text-sm text-warning">{error}</p>}
      </form>
    </div>
  );
}

const QUICK_START_TOOLS = [
  "Gemini API",
  "Grok",
  "Runway",
  "ElevenLabs",
  "Cursor Pro",
] as const;

export default function Dashboard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [spent, setSpent] = useState(INITIAL_SPENT);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [serviceAmounts, setServiceAmounts] = useState<Record<string, number>>(
    {},
  );
  const [scanHistory, setScanHistory] = useState<BillingScan[]>([]);

  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [isWaitlistSubmitting, setIsWaitlistSubmitting] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isFounding, setIsFounding] = useState(false);
  const [isManualCorrectionOpen, setIsManualCorrectionOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const [manualService, setManualService] = useState<ServiceName>("OpenAI API");
  const [manualAmount, setManualAmount] = useState("");
  const [manualPeriod, setManualPeriod] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [manualUsageBased, setManualUsageBased] = useState(true);
  const [budget, setBudget] = useState<number | null>(null);
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState("");
  const [customTools, setCustomTools] = useState<CustomToolPref[]>([]);
  const [hiddenTools, setHiddenTools] = useState<string[]>([]);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<
    "idle" | "syncing" | "synced" | "error"
  >("idle");
  const [foundingVerifyMessage, setFoundingVerifyMessage] = useState<
    string | null
  >(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const cloudHydratedForRef = useRef<string | null>(null);
  const clearingDeviceOnSignOutRef = useRef(false);

  const catalog: ToolDef[] = (() => {
    const base: ToolDef[] = [
      ...PRESET_TOOLS,
      ...customTools.map((tool, index) => toolFromCustom(tool, index)),
    ];
    const known = new Set(base.map((tool) => tool.name));
    const extras: ToolDef[] = Object.keys(serviceAmounts)
      .filter((name) => !known.has(name))
      .map((name) => ({
        name,
        type: "Custom",
        suggestedAmount: 0,
        isUsageBased: true,
        accent: "bg-sage/25 text-sage-soft",
        origin: "custom" as const,
      }));
    return [...base, ...extras];
  })();

  const visibleTools = catalog
    .filter(
      (tool) =>
        serviceAmounts[tool.name] !== undefined ||
        !hiddenTools.includes(tool.name),
    )
    .sort((a, b) => {
      const aSet = serviceAmounts[a.name] !== undefined;
      const bSet = serviceAmounts[b.name] !== undefined;
      if (aSet !== bSet) return aSet ? -1 : 1;
      if (aSet && bSet) {
        return (serviceAmounts[b.name] ?? 0) - (serviceAmounts[a.name] ?? 0);
      }
      return a.name.localeCompare(b.name);
    });

  const animatedSpent = useAnimatedNumber(spent);
  const projected = computeProjectedSpend(serviceAmounts, catalog);
  const showFullOutlook = canSeeFullOutlook(isFounding);
  const showStackPulse = canSeeStackPulse(isFounding);
  const effectiveBudget = clampBudgetForPlan(isFounding, budget);
  const budgetBasis = effectiveBudget && effectiveBudget > 0 ? effectiveBudget : null;
  const budgetCompare = showFullOutlook ? projected : spent;
  const meterRatio = budgetBasis
    ? Math.min((budgetCompare / budgetBasis) * 100, 100)
    : 0;
  const remaining =
    budgetBasis != null ? Math.max(budgetBasis - budgetCompare, 0) : null;
  const overspend =
    budgetBasis != null
      ? Math.round((budgetCompare - budgetBasis) * 100) / 100
      : 0;
  const isOverBudget = budgetBasis != null && budgetCompare > budgetBasis;
  const stackPulse = computeStackPulse(
    serviceAmounts,
    spent,
    projected,
    budgetBasis,
  );
  const isScanning = scanStatus === "scanning";
  const trackedCount = Object.keys(serviceAmounts).length;
  const monthEnd = endOfMonthLabel();
  const hasSpend = spent > 0 || trackedCount > 0;
  const usageTracked = catalog
    .filter(
      (tool) =>
        tool.isUsageBased && serviceAmounts[tool.name] !== undefined,
    )
    .reduce((sum, tool) => sum + (serviceAmounts[tool.name] ?? 0), 0);
  const fixedTracked = Math.round((spent - usageTracked) * 100) / 100;
  const hiddenUnsetCount = PRESET_TOOLS.filter(
    (tool) =>
      hiddenTools.includes(tool.name) &&
      serviceAmounts[tool.name] === undefined,
  ).length;
  const serviceOptions = Array.from(
    new Set([...catalog.map((tool) => tool.name), ...PRESET_SERVICES]),
  );

  function currentPrefs() {
    return {
      budget,
      hiddenTools,
      customTools,
      isFounding,
    };
  }

  function persistPrefs(next: {
    budget?: number | null;
    hiddenTools?: string[];
    customTools?: CustomToolPref[];
    isFounding?: boolean;
  }) {
    const merged = { ...currentPrefs(), ...next };
    if (next.budget !== undefined) {
      const clamped = clampBudgetForPlan(merged.isFounding, merged.budget);
      merged.budget = clamped;
      setBudget(clamped);
      writeBudget(clamped);
    }
    if (next.hiddenTools !== undefined) {
      setHiddenTools(merged.hiddenTools);
      writeHiddenTools(merged.hiddenTools);
    }
    if (next.customTools !== undefined) {
      setCustomTools(merged.customTools);
      writeCustomTools(merged.customTools);
    }
    if (next.isFounding !== undefined) {
      setIsFounding(merged.isFounding);
      writeFounding(merged.isFounding);
    }

    const supabase = supabaseRef.current;
    if (supabase && isLoggedIn) {
      void persistPrefsToCloud(supabase, merged).catch(() => {});
    }
  }

  function applyDashboardState(
    history: BillingScan[],
    nextSpent: number,
    nextAmounts: Record<string, number>,
  ) {
    setScanHistory(history);
    setServiceAmounts(nextAmounts);
    setSpent(nextSpent);
    const newest = history[0]?.scannedAt;
    if (newest) {
      setLastSyncedAt(formatClock(new Date(newest)));
    }
  }

  useEffect(() => {
    // Intentional client-only hydrate from localStorage (no SSR equivalent).
    const local = readLocalPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount hydrate from device prefs
    setBudget(clampBudgetForPlan(local.isFounding, local.budget));
    setHiddenTools(local.hiddenTools);
    setCustomTools(local.customTools);
    setIsFounding(local.isFounding);

    const params = new URLSearchParams(window.location.search);
    const stripeSessionId =
      params.get("stripe_session_id") || params.get("session_id");
    const justSignedIn = params.get("signed_in") === "1";
    const authError = params.get("auth_error") === "1";
    const authReason = params.get("auth_reason");

    if (authError) {
      const reasonHint =
        authReason === "missing_code"
          ? " The link had no login code — open the newest email on the same browser you used to request it."
          : " Links expire after a short time and can only be used once.";
      setAuthNotice(
        `That sign-in link expired or failed.${reasonHint} Request a new magic link from Sign in.`,
      );
    }

    const supabase = createClient();
    supabaseRef.current = supabase;

    function clearAuthParams() {
      params.delete("stripe_session_id");
      params.delete("session_id");
      params.delete("upgraded");
      params.delete("founding");
      params.delete("signed_in");
      params.delete("auth_error");
      params.delete("auth_reason");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }

    async function confirmStripeSession(sessionId: string) {
      try {
        const response = await fetch(
          `/api/stripe/confirm?session_id=${encodeURIComponent(sessionId)}`,
        );
        const result = (await response.json()) as {
          isFounding?: boolean;
          matchesSignedInUser?: boolean;
          email?: string;
          error?: string;
        };

        if (result.isFounding) {
          setIsFounding(true);
          writeFounding(true);
          if (result.matchesSignedInUser) {
            setFoundingVerifyMessage(
              "ToRay Pro verified — Gemini & Grok Vision are unlocked.",
            );
          } else if (result.email) {
            setFoundingVerifyMessage(
              `Checkout verified for ${result.email}. Sign in with that email to unlock Pro features.`,
            );
          } else {
            setFoundingVerifyMessage(
              "Checkout verified. Sign in with your Stripe email to unlock Pro features.",
            );
          }
        } else if (result.error) {
          setFoundingVerifyMessage(result.error);
        }
      } catch {
        setFoundingVerifyMessage(
          "Could not verify Stripe checkout. Try signing in with your checkout email.",
        );
      } finally {
        clearAuthParams();
      }
    }

    async function refreshFoundingStatus(): Promise<boolean | null> {
      try {
        const response = await fetch("/api/founding/status");
        const result = (await response.json()) as {
          isFounding?: boolean;
          signedIn?: boolean;
        };
        if (result.signedIn) {
          const next = Boolean(result.isFounding);
          setIsFounding(next);
          writeFounding(next);
          return next;
        }
      } catch {
        // Keep local preference if the status endpoint is unavailable.
      }
      return null;
    }

    function readLocalHistory(): BillingScan[] {
      const stored = window.localStorage.getItem(SCAN_HISTORY_KEY);
      if (!stored) return [];
      try {
        return JSON.parse(stored) as BillingScan[];
      } catch {
        window.localStorage.removeItem(SCAN_HISTORY_KEY);
        return [];
      }
    }

    async function syncCloudForUser(user: {
      email?: string | null;
      user_metadata?: Record<string, unknown>;
    }) {
      if (!user.email) return;
      if (cloudHydratedForRef.current === user.email) return;
      cloudHydratedForRef.current = user.email;

      setUserEmail(user.email);
      setIsLoggedIn(true);
      setIsSignInOpen(false);

      const remotePrefs = mergePrefs(
        local,
        user.user_metadata as {
          toray_budget?: number | null;
          toray_hidden_tools?: string[];
          toray_custom_tools?: CustomToolPref[];
          toray_founding?: boolean;
        },
      );
      setHiddenTools(remotePrefs.hiddenTools);
      setCustomTools(remotePrefs.customTools);
      writeHiddenTools(remotePrefs.hiddenTools);
      writeCustomTools(remotePrefs.customTools);

      const foundingNow =
        (await refreshFoundingStatus()) ?? remotePrefs.isFounding;
      const clampedBudget = clampBudgetForPlan(
        foundingNow,
        remotePrefs.budget,
      );
      setBudget(clampedBudget);
      writeBudget(clampedBudget);

      if (justSignedIn) {
        setAuthNotice(
          foundingNow
            ? "Signed in with ToRay Pro — unlimited tools, outlook, Stack Pulse, and Vision extras are on."
            : `Signed in — cloud backup is on for this email. Free plan still applies (${FREE_TOOL_LIMIT} tools · $${FREE_BUDGET_CAP} budget). ToRay Pro is a separate upgrade.`,
        );
        clearAuthParams();
      } else if (!authError) {
        setAuthNotice(
          foundingNow
            ? `Signed in as ${user.email} · ToRay Pro active`
            : `Signed in as ${user.email} · Free backup on (not Pro)`,
        );
      }

      const localHistory = readLocalHistory();
      setCloudSyncStatus("syncing");
      try {
        const remoteHistory = await fetchUserBillingScans(supabase);
        const merged = mergeBillingScanHistories(localHistory, remoteHistory);
        const dashboard = applyHistoryToDashboard(
          merged,
          INITIAL_SPENT,
          [
            ...PRESET_TOOLS.map((tool) => ({ name: tool.name, amount: 0 })),
            ...remotePrefs.customTools.map((tool) => ({
              name: tool.name,
              amount: 0,
            })),
          ],
        );
        applyDashboardState(
          dashboard.scanHistory,
          dashboard.spent,
          dashboard.serviceAmounts,
        );
        window.localStorage.setItem(
          SCAN_HISTORY_KEY,
          JSON.stringify(dashboard.scanHistory),
        );
        setCloudSyncStatus("synced");
        window.setTimeout(() => setCloudSyncStatus("idle"), 2500);
      } catch {
        setCloudSyncStatus("error");
      }
    }

    async function hydrateDashboard() {
      const localHistory = readLocalHistory();
      const serviceDefaults = [
        ...PRESET_TOOLS.map((tool) => ({ name: tool.name, amount: 0 })),
        ...local.customTools.map((tool) => ({ name: tool.name, amount: 0 })),
      ];

      if (localHistory.length > 0) {
        const localDashboard = applyHistoryToDashboard(
          localHistory,
          INITIAL_SPENT,
          serviceDefaults,
        );
        applyDashboardState(
          localDashboard.scanHistory,
          localDashboard.spent,
          localDashboard.serviceAmounts,
        );
      }

      if (stripeSessionId) {
        await confirmStripeSession(stripeSessionId);
      } else if (authError || justSignedIn) {
        // Keep signed_in until syncCloudForUser clears it after Pro status is known.
        if (authError) clearAuthParams();
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.email) {
        await syncCloudForUser(session.user);
      } else if (justSignedIn) {
        setAuthNotice(
          "Sign-in link opened, but no session was found. Try the link again or request a new one.",
        );
        clearAuthParams();
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        cloudHydratedForRef.current = null;
        setIsLoggedIn(false);
        setUserEmail(null);
        setCloudSyncStatus("idle");
        // handleSignOut already wiped the device; avoid a second conflicting notice.
        if (!clearingDeviceOnSignOutRef.current) {
          setAuthNotice(
            "Signed out. Sign in again to restore your backed-up totals.",
          );
        }
        clearingDeviceOnSignOutRef.current = false;
        return;
      }

      if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session?.user?.email
      ) {
        if (event === "SIGNED_IN") {
          cloudHydratedForRef.current = null;
        }
        void syncCloudForUser(session.user);
      }
    });

    void hydrateDashboard();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (scanStatus !== "success" || !scanMessage) return;
    const timer = window.setTimeout(() => {
      setScanMessage(null);
      setScanStatus("idle");
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [scanStatus, scanMessage]);

  async function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = waitlistEmail.trim();

    if (!isValidEmail(trimmed)) {
      setWaitlistError("Please enter a valid email address.");
      return;
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      setWaitlistError(
        "Sign-up is temporarily unavailable. Please try again later.",
      );
      return;
    }

    setWaitlistError(null);
    setIsWaitlistSubmitting(true);

    try {
      const supabase = supabaseRef.current ?? createClient();
      supabaseRef.current = supabase;
      // Always use the current host so production links don't point at localhost
      // when NEXT_PUBLIC_SITE_URL is wrong in the build env.
      const redirectTo = `${window.location.origin}/auth/callback`;

      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) throw error;

      const formspreeEndpoint = process.env.NEXT_PUBLIC_FORMSPREE_ENDPOINT;
      if (formspreeEndpoint) {
        const formData = new FormData();
        formData.append("email", trimmed);
        void fetch(formspreeEndpoint, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: formData,
        }).catch(() => {});
      }

      setWaitlistSubmitted(true);
    } catch {
      setWaitlistError(
        "We could not send your magic link. Please check your connection and try again.",
      );
    } finally {
      setIsWaitlistSubmitting(false);
    }
  }

  function openSignIn() {
    setIsSignInOpen(true);
  }

  function resetDeviceDashboard() {
    window.localStorage.removeItem(SCAN_HISTORY_KEY);
    const { hiddenTools: starterHidden } = clearLocalAccountData();
    setScanHistory([]);
    setServiceAmounts({});
    setSpent(INITIAL_SPENT);
    setBudget(null);
    setCustomTools([]);
    setHiddenTools(starterHidden);
    setIsFounding(false);
    setLastSyncedAt(null);
    setPreviewUrl(null);
    setScanMessage(null);
    setScanStatus("idle");
    setFoundingVerifyMessage(null);
  }

  async function handleSignOut() {
    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;

    // Best-effort cloud save before wiping the device copy.
    if (isLoggedIn) {
      try {
        await persistPrefsToCloud(supabase, currentPrefs());
      } catch {
        // Continue signing out even if the last sync fails.
      }
    }

    clearingDeviceOnSignOutRef.current = true;
    resetDeviceDashboard();
    cloudHydratedForRef.current = null;
    setIsLoggedIn(false);
    setUserEmail(null);
    setCloudSyncStatus("idle");
    setIsSignInOpen(false);
    setAuthNotice(
      "Signed out and cleared this device. Sign in again to restore your cloud backup.",
    );

    try {
      await supabase.auth.signOut();
    } catch {
      // Local UI already cleared.
    }
  }

  function promptFoundingUpgrade(message: string) {
    setFoundingVerifyMessage(message);
    document
      .getElementById("founding-member")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function markUpdated(at = new Date()) {
    setLastSyncedAt(formatClock(at));
  }

  function commitBudgetDraft() {
    if (!canUseBudget(isFounding)) {
      promptFoundingUpgrade(
        foundingUpgradeHint("Budget and overspend coaching"),
      );
      setIsEditingBudget(false);
      return;
    }
    const parsed = Number.parseFloat(budgetDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      persistPrefs({ budget: null });
      setIsEditingBudget(false);
      return;
    }
    if (budgetExceedsFreeCap(isFounding, parsed)) {
      promptFoundingUpgrade(freeBudgetCapMessage());
      setBudgetDraft(String(FREE_BUDGET_CAP));
      return;
    }
    persistPrefs({ budget: Math.round(parsed * 100) / 100 });
    setIsEditingBudget(false);
  }

  function applySuggestedBudget(raw: number) {
    if (budgetExceedsFreeCap(isFounding, raw)) {
      promptFoundingUpgrade(freeBudgetCapMessage());
      persistPrefs({ budget: FREE_BUDGET_CAP });
      setIsEditingBudget(false);
      return;
    }
    persistPrefs({ budget: raw });
    setIsEditingBudget(false);
  }

  async function syncScanToCloud(scan: BillingScan) {
    const supabase = supabaseRef.current;
    if (!supabase || !isLoggedIn) return;

    setCloudSyncStatus("syncing");
    try {
      await insertBillingScan(supabase, scan);
      setCloudSyncStatus("synced");
      window.setTimeout(() => setCloudSyncStatus("idle"), 2500);
    } catch {
      setCloudSyncStatus("error");
    }
  }

  function saveBillingScan(scan: BillingScan): boolean {
    if (
      wouldExceedFreeToolLimit(
        isFounding,
        trackedCount,
        scan.service,
        serviceAmounts,
      )
    ) {
      promptFoundingUpgrade(freeToolLimitMessage(trackedCount));
      return false;
    }

    const existingAmount = serviceAmounts[scan.service] ?? 0;

    setServiceAmounts((current) => ({
      ...current,
      [scan.service]: scan.amountUsd,
    }));
    setSpent((current) => current - existingAmount + scan.amountUsd);
    setScanHistory((current) => {
      const next = [scan, ...current].slice(0, 50);
      window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    markUpdated();
    void syncScanToCloud(scan);
    return true;
  }

  function clearTrackedTool(name: ServiceName) {
    const existingAmount = serviceAmounts[name];
    if (existingAmount === undefined) return;

    setServiceAmounts((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setSpent((current) => Math.max(0, current - existingAmount));
    setScanHistory((current) => {
      const next = current.filter((scan) => scan.service !== name);
      window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    markUpdated();
    setScanStatus("success");
    setScanMessage(`${name} removed from this month’s total`);
    setIsManualCorrectionOpen(false);

    const supabase = supabaseRef.current;
    if (supabase && isLoggedIn) {
      setCloudSyncStatus("syncing");
      void deleteBillingScansForService(supabase, name)
        .then(() => {
          setCloudSyncStatus("synced");
          window.setTimeout(() => setCloudSyncStatus("idle"), 2500);
        })
        .catch(() => setCloudSyncStatus("error"));
    }
  }

  function deleteCustomTool(name: ServiceName) {
    const isCustom = customTools.some(
      (tool) => tool.name.toLowerCase() === name.toLowerCase(),
    );
    if (!isCustom) return;

    if (serviceAmounts[name] !== undefined) {
      clearTrackedTool(name);
    }

    persistPrefs({
      customTools: customTools.filter(
        (tool) => tool.name.toLowerCase() !== name.toLowerCase(),
      ),
      hiddenTools: hiddenTools.filter(
        (item) => item.toLowerCase() !== name.toLowerCase(),
      ),
    });
    setScanStatus("success");
    setScanMessage(`${name} deleted from your tools`);
    setIsManualCorrectionOpen(false);
  }

  function findTool(name: ServiceName): ToolDef | undefined {
    return catalog.find((tool) => tool.name === name);
  }

  function openManualCorrection(
    service: ServiceName = "OpenAI API",
    amount?: number,
    period?: string | null,
    options?: { custom?: boolean },
  ) {
    const custom = Boolean(options?.custom);
    const resolvedService = custom
      ? service || "OpenAI API"
      : service || "OpenAI API";

    if (
      wouldExceedFreeToolLimit(
        isFounding,
        trackedCount,
        resolvedService,
        serviceAmounts,
      ) ||
      (custom &&
        wouldExceedFreeToolLimit(
          isFounding,
          trackedCount,
          "__new_custom__",
          serviceAmounts,
        ))
    ) {
      promptFoundingUpgrade(freeToolLimitMessage(trackedCount));
      return;
    }

    const tool = findTool(resolvedService);
    const suggested = tool?.suggestedAmount ?? 0;
    const currentAmount =
      amount ?? serviceAmounts[resolvedService] ?? (custom ? 0 : suggested);

    setIsCustomMode(custom);
    setCustomName(custom ? "" : resolvedService);
    setManualService(resolvedService);
    setManualUsageBased(tool?.isUsageBased ?? true);
    setManualAmount(
      amount !== undefined || serviceAmounts[resolvedService] !== undefined
        ? currentAmount.toFixed(2)
        : custom
          ? ""
          : suggested > 0
            ? suggested.toFixed(2)
            : "",
    );
    setManualPeriod(period ?? "");
    setManualError(null);
    setIsManualCorrectionOpen(true);
  }

  function saveManualCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number.parseFloat(manualAmount);
    const resolvedName = (
      isCustomMode ? customName : manualService
    ).trim();

    if (!isValidServiceName(resolvedName)) {
      setManualError("Enter a tool name (1–64 characters).");
      return;
    }

    if (!Number.isFinite(amount) || amount < 0) {
      setManualError("Enter a valid USD amount of zero or more.");
      return;
    }

    if (
      wouldExceedFreeToolLimit(
        isFounding,
        trackedCount,
        resolvedName,
        serviceAmounts,
      )
    ) {
      setManualError(freeToolLimitMessage(trackedCount));
      promptFoundingUpgrade(freeToolLimitMessage(trackedCount));
      return;
    }

    const existingCustom = customTools.some(
      (tool) => tool.name.toLowerCase() === resolvedName.toLowerCase(),
    );
    const isPreset = (PRESET_SERVICES as readonly string[]).includes(
      resolvedName,
    );

    if (!isPreset && !existingCustom) {
      const nextCustom: CustomToolPref[] = [
        ...customTools,
        {
          name: resolvedName,
          isUsageBased: manualUsageBased,
          suggestedAmount: amount,
        },
      ];
      persistPrefs({ customTools: nextCustom });
    } else if (!isPreset && existingCustom) {
      persistPrefs({
        customTools: customTools.map((tool) =>
          tool.name.toLowerCase() === resolvedName.toLowerCase()
            ? { ...tool, isUsageBased: manualUsageBased }
            : tool,
        ),
      });
    }

    // Unhide if it was hidden
    if (hiddenTools.includes(resolvedName)) {
      persistPrefs({
        hiddenTools: hiddenTools.filter((name) => name !== resolvedName),
      });
    }

    const saved = saveBillingScan({
      id: crypto.randomUUID(),
      service: resolvedName,
      amountUsd: Math.round(amount * 100) / 100,
      billingPeriod:
        manualPeriod.trim() ||
        (manualUsageBased ? null : "Monthly subscription"),
      confidence: "high",
      scannedAt: new Date().toISOString(),
    });
    if (!saved) return;

    setScanStatus("success");
    setScanMessage(
      `${resolvedName} · $${amount.toFixed(2)} saved to your dashboard`,
    );
    setIsManualCorrectionOpen(false);
  }

  async function runBillingScan(file: File) {
    if (!ALLOWED_TYPES.has(file.type)) {
      setScanStatus("error");
      setScanMessage("PNG, JPEG or WebP only");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setScanStatus("error");
      setScanMessage("Keep it under 10MB");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setScanStatus("scanning");
    setScanMessage(null);
    setScanStep(0);

    try {
      const formData = new FormData();
      formData.append("image", file);
      setScanStep(1);

      const response = await fetch("/api/analyze-billing", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        service?: string | null;
        amountUsd?: number;
        billingPeriod?: string | null;
        confidence?: "high" | "medium" | "low";
        error?: string;
        code?: string;
      };

      if (response.status === 402 || result.code === "FOUNDING_REQUIRED") {
        const hinted =
          result.service === "Gemini"
            ? "Gemini API"
            : result.service === "Grok"
              ? "Grok"
              : "Gemini API";
        setScanStatus("error");
        setScanMessage(
          result.error ??
            "Gemini and Grok Vision is included with ToRay Pro — $12/mo. Enter the amount manually within your free tool limit, or upgrade.",
        );
        openManualCorrection(hinted, undefined, null, { custom: false });
        document
          .getElementById("founding-member")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }

      if (
        !response.ok ||
        typeof result.amountUsd !== "number" ||
        result.confidence === "low" ||
        !isVisionProvider(result.service)
      ) {
        throw new Error(
          result.error ??
            "This does not look like a clear supported billing screen. Use Add tool to enter any provider manually.",
        );
      }

      setScanStep(2);
      const amountUsd = result.amountUsd;
      const serviceName: ServiceName = visionProviderToToolName(result.service);

      if (
        wouldExceedFreeToolLimit(
          isFounding,
          trackedCount,
          serviceName,
          serviceAmounts,
        )
      ) {
        setScanStatus("error");
        setScanMessage(freeToolLimitMessage(trackedCount));
        promptFoundingUpgrade(freeToolLimitMessage(trackedCount));
        return;
      }

      const scan: BillingScan = {
        id: crypto.randomUUID(),
        service: serviceName,
        amountUsd,
        billingPeriod: result.billingPeriod ?? null,
        confidence: result.confidence ?? "medium",
        scannedAt: new Date().toISOString(),
      };

      if (!saveBillingScan(scan)) {
        setScanStatus("error");
        setScanMessage(freeToolLimitMessage(trackedCount));
        return;
      }
      setScanStatus("success");
      setScanMessage(
        `${serviceName} · $${amountUsd.toFixed(2)} saved to your dashboard`,
      );
    } catch (error) {
      setScanStatus("error");
      setScanMessage(
        error instanceof Error
          ? error.message
          : "The billing scanner could not analyze this image.",
      );
      openManualCorrection("OpenAI API", undefined, null, { custom: false });
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void runBillingScan(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isScanning) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void runBillingScan(file);
  }

  function hideTool(name: string) {
    if (serviceAmounts[name] !== undefined) return;
    if (hiddenTools.includes(name)) return;
    persistPrefs({ hiddenTools: [...hiddenTools, name] });
  }

  function hideAllUnset() {
    const next = Array.from(
      new Set([
        ...hiddenTools,
        ...PRESET_TOOLS.filter(
          (tool) => serviceAmounts[tool.name] === undefined,
        ).map((tool) => tool.name),
      ]),
    );
    persistPrefs({ hiddenTools: next });
  }

  function showHiddenTools() {
    persistPrefs({ hiddenTools: [] });
  }

  function exportCsv() {
    if (!canExportCsv(isFounding)) {
      promptFoundingUpgrade(foundingUpgradeHint("CSV export"));
      return;
    }
    downloadSpendCsv({
      amounts: serviceAmounts,
      history: scanHistory,
      budget,
      projected,
    });
  }

  const stripeHref = buildStripeHref(userEmail);
  const showBudgetControls = canUseBudget(isFounding);
  const planChip = isFounding ? "ToRay Pro" : "Free plan";
  const storageChip = isLoggedIn ? "Backed up" : "This device";
  const historyLabel =
    scanHistory.length === 0
      ? `No updates yet · ${storageChip} · ${planChip}`
      : isFounding
        ? `${scanHistory.length} update${scanHistory.length === 1 ? "" : "s"} · ${storageChip} · ${planChip}`
        : `Latest update · ${storageChip} · ${planChip}`;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-bone selection:bg-sage/40">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,158,124,0.22),_transparent_55%)]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-40 h-80 w-80 rounded-full bg-clay/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -left-16 bottom-32 h-72 w-72 rounded-full bg-blush/10 blur-3xl" />

      <header className="relative z-10 border-b border-hairline">
        <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="font-serif text-[22px] tracking-[-0.02em] text-bone">
              ToRay<span className="text-mint">.</span>
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-2 text-sm text-bone-muted md:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
              </span>
              {isFounding ? "ToRay Pro" : "Free to scan"}
            </span>
            {isLoggedIn ? (
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="max-w-[96px] truncate text-[12px] text-bone-muted sm:max-w-[160px] sm:text-sm">
                  {userEmail}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:text-bone"
                  aria-label="Sign out"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openSignIn}
                className="rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:text-bone"
              >
                Sign in
              </button>
            )}
            {!isFounding && (
              <a
                href={stripeHref}
                className="rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:border-sage-soft/40 hover:text-bone"
              >
                Pro
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        {(authNotice || isLoggedIn) && (
          <div
            className={`mt-6 rounded-[20px] border px-4 py-3 md:px-5 ${
              isFounding
                ? "border-mint/35 bg-mint/10"
                : "border-sage/30 bg-sage/10"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sage-soft">
                  {isLoggedIn
                    ? isFounding
                      ? "Account · ToRay Pro"
                      : "Account · Free backup"
                    : "Account"}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-bone">
                  {authNotice ??
                    (isFounding
                      ? `Signed in as ${userEmail}. Pro features unlocked.`
                      : `Signed in as ${userEmail}. Backup is on — Free limits still apply (${FREE_TOOL_LIMIT} tools · $${FREE_BUDGET_CAP} budget).`)}
                </p>
                {isLoggedIn && !isFounding && (
                  <p className="mt-1 text-[12px] text-bone-muted">
                    Sign-in ≠ Pro. Upgrade separately for outlook, Stack Pulse,
                    CSV, and Gemini/Grok Vision.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isLoggedIn && !isFounding && (
                  <a
                    href={stripeHref}
                    className="rounded-full bg-sage px-3 py-1.5 text-[12px] font-medium text-bone transition hover:bg-sage-glow"
                  >
                    Upgrade to Pro
                  </a>
                )}
                {isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="rounded-full border border-hairline px-3 py-1.5 text-[12px] text-bone-muted transition hover:text-bone"
                  >
                    Sign out
                  </button>
                )}
                {authNotice && (
                  <button
                    type="button"
                    onClick={() => setAuthNotice(null)}
                    className="rounded-full p-1.5 text-bone-muted transition hover:bg-bone/10 hover:text-bone"
                    aria-label="Dismiss notice"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <section className="grid grid-cols-1 items-start gap-8 py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
          <div>
            <Eyebrow>Free Instant Scanner</Eyebrow>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
              Know your AI burn before your card does.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-bone-muted">
              Free: scan OpenAI or Anthropic, track up to {FREE_TOOL_LIMIT}{" "}
              tools, and set a budget up to ${FREE_BUDGET_CAP}/mo. ToRay Pro
              unlocks unlimited tools & budget, Gemini/Grok Vision, outlook,
              Stack Pulse, and CSV.
            </p>
            <p className="mt-3 text-[13px] text-bone-muted">
              Screenshots are analyzed securely and not stored by ToRay. Totals
              stay on this device until you sign in.
            </p>
            <p className="mt-6 text-sm text-bone-muted">
              {lastSyncedAt
                ? `Last update ${lastSyncedAt} · ${storageChip} · ${planChip}`
                : hasSpend
                  ? `Totals ready · ${storageChip} · ${planChip}`
                  : `Empty dashboard · ${storageChip} · ${planChip}`}
            </p>
          </div>

          <div id="quick-scan" className="rounded-[28px] border border-sage/35 bg-surface p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Scan now</Eyebrow>
              <span className="text-[12px] text-mint">
                {cloudSyncStatus === "syncing"
                  ? "Saving to cloud…"
                  : cloudSyncStatus === "error"
                    ? "Cloud save failed — kept on this device"
                    : historyLabel}
              </span>
            </div>

            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileChange} />

            <div
              onDragOver={(e) => { e.preventDefault(); if (!isScanning) setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative mt-4 flex min-h-[240px] flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed px-5 text-center transition duration-180 ${isDragging ? "border-sage-soft bg-sage/15" : "border-hairline bg-background/40"} ${isScanning ? "pointer-events-none" : ""}`}
            >
              {isScanning && (
                <span aria-hidden className="animate-toray-scan pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sage-soft to-transparent" />
              )}

              {isScanning ? (
                <ScanLoader stepIndex={scanStep} />
              ) : (
                <>
                  {previewUrl && scanStatus === "success" ? (
                    <div className="mb-3 overflow-hidden rounded-2xl border border-hairline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={previewUrl} alt="Uploaded usage screenshot" className="h-16 w-28 object-cover opacity-80" />
                    </div>
                  ) : (
                    <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-sage/20">
                      <ScanLine className={`h-6 w-6 transition-colors ${isDragging ? "text-sage-soft" : "text-sage-soft/70"}`} strokeWidth={1.5} />
                    </div>
                  )}
                  <h2 className="mt-2 font-serif text-xl text-bone">Drop a billing screenshot</h2>
                  <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-bone-muted">
                    {isFounding
                      ? "OpenAI, Anthropic, Gemini, or Grok billing consoles — Vision unlocked."
                      : `OpenAI / Anthropic Vision free · up to ${FREE_TOOL_LIMIT} tools. Gemini/Grok Vision + unlimited tools with ToRay Pro.`}
                  </p>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-5 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition hover:bg-sage-glow">
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={() => openManualCorrection("Gemini API")}
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add any tool manually
                  </button>
                </>
              )}
            </div>

            {scanMessage && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className={`text-[13px] ${scanStatus === "error" ? "text-warning" : scanStatus === "success" ? "text-mint" : "text-bone-muted"}`}>
                  {scanMessage}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const latestScan = scanHistory[0];
                    openManualCorrection(
                      latestScan?.service ?? "OpenAI API",
                      latestScan?.amountUsd,
                      latestScan?.billingPeriod,
                    );
                  }}
                  className="inline-flex items-center gap-1 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  {scanStatus === "success" ? "Correct amount" : "Enter manually"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScanMessage(null);
                    if (scanStatus === "success") setScanStatus("idle");
                  }}
                  className="text-[13px] text-bone-muted underline-offset-4 transition hover:text-bone hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </section>

        {!isLoggedIn && (
          <div className="mb-8 md:hidden">
            <MobileDesktopBridgeBanner
              email={waitlistEmail}
              onEmailChange={setWaitlistEmail}
              submitted={waitlistSubmitted}
              isSubmitting={isWaitlistSubmitting}
              onSubmit={handleWaitlistSubmit}
              error={waitlistError}
            />
          </div>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>This month</Eyebrow>
              <div className="flex items-center gap-2">
                {showBudgetControls && budgetBasis != null && !isEditingBudget && (
                  <button
                    type="button"
                    onClick={() => {
                      setBudgetDraft(String(Math.round(budgetBasis)));
                      setIsEditingBudget(true);
                    }}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-sage-soft transition hover:text-bone"
                  >
                    Edit budget
                  </button>
                )}
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${!hasSpend ? "bg-bone/10 text-bone-muted" : showBudgetControls && isOverBudget ? "bg-danger/20 text-danger" : "bg-sage/25 text-mint"}`}>
                  {!hasSpend
                    ? "Empty"
                    : showBudgetControls && isOverBudget
                      ? "Over budget"
                      : showBudgetControls && budgetBasis != null
                        ? "On track"
                        : "Tracked"}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-baseline gap-2">
              <span className={`font-serif text-4xl tracking-[-0.02em] tabular-nums transition-colors duration-500 ${scanStatus === "success" ? "text-mint" : "text-bone"}`}>
                ${animatedSpent.toFixed(2)}
              </span>
              {showBudgetControls && budgetBasis != null && !isEditingBudget ? (
                <span className="text-sm tabular-nums text-bone-muted">
                  spent · ${budgetBasis.toFixed(0)} budget
                  {!isFounding ? ` · max $${FREE_BUDGET_CAP}` : ""}
                </span>
              ) : null}
            </div>
            <div className="mt-6">
              {showBudgetControls && budgetBasis != null && !isEditingBudget ? (
                <>
                  <Meter ratio={meterRatio} />
                  <div className="mt-2.5 flex justify-between text-xs text-bone-muted">
                    <span>
                      {meterRatio.toFixed(0)}% of budget
                      {showFullOutlook ? " (outlook)" : " (spent)"}
                    </span>
                    <span>
                      {remaining != null
                        ? `$${remaining.toFixed(0)} headroom`
                        : null}
                    </span>
                  </div>
                </>
              ) : isEditingBudget ? (
                <form
                  noValidate
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitBudgetDraft();
                  }}
                >
                  <label className="flex items-center gap-1 rounded-full border border-hairline bg-background px-3 py-1.5 text-sm text-bone-muted">
                    $
                    <input
                      type="number"
                      step="1"
                      inputMode="decimal"
                      value={budgetDraft}
                      onChange={(event) => setBudgetDraft(event.target.value)}
                      className="w-20 bg-transparent text-bone outline-none"
                      aria-label="Monthly budget"
                      autoFocus
                      placeholder="e.g. 150"
                    />
                  </label>
                  <button type="submit" className="rounded-full bg-sage px-3 py-1.5 text-xs font-medium text-bone">
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingBudget(false)}
                    className="text-xs text-bone-muted hover:text-bone"
                  >
                    Cancel
                  </button>
                  {budget != null && (
                    <button
                      type="button"
                      onClick={() => {
                        persistPrefs({ budget: null });
                        setIsEditingBudget(false);
                      }}
                      className="text-xs text-bone-muted hover:text-bone"
                    >
                      Clear
                    </button>
                  )}
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setBudgetDraft("");
                      setIsEditingBudget(true);
                    }}
                    className="text-sm text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                  >
                    Set a monthly budget
                  </button>
                  {hasSpend && showFullOutlook && (
                    <button
                      type="button"
                      onClick={() =>
                        applySuggestedBudget(Math.ceil(projected / 10) * 10)
                      }
                      className="text-[12px] text-bone-muted underline-offset-2 transition hover:text-bone hover:underline"
                    >
                      Use outlook (${Math.ceil(projected / 10) * 10})
                    </button>
                  )}
                  {hasSpend && !showFullOutlook && (
                    <button
                      type="button"
                      onClick={() =>
                        applySuggestedBudget(
                          Math.min(
                            FREE_BUDGET_CAP,
                            Math.max(50, Math.ceil(spent / 10) * 10),
                          ),
                        )
                      }
                      className="text-[12px] text-bone-muted underline-offset-2 transition hover:text-bone hover:underline"
                    >
                      Suggest from spent
                    </button>
                  )}
                </div>
              )}
              {showBudgetControls && (
                <>
                  <p className={`mt-3 text-[13px] ${isOverBudget ? "text-danger" : "text-bone-muted"}`}>
                    {!hasSpend
                      ? "Scan or add a tool, then set a budget to stay honest."
                      : showFullOutlook
                        ? isOverBudget
                          ? `Outlook $${projected.toFixed(0)} by ${monthEnd} — $${overspend.toFixed(0)} over.`
                          : `Outlook $${projected.toFixed(0)} by ${monthEnd}`
                        : isOverBudget
                          ? `Spent $${spent.toFixed(0)} — $${overspend.toFixed(0)} over your free budget.`
                          : budgetBasis
                            ? `Free budget up to $${FREE_BUDGET_CAP}/mo · $${remaining?.toFixed(0) ?? 0} left vs spent.`
                            : `Free budgets go up to $${FREE_BUDGET_CAP}/mo.`}
                  </p>
                  {!isFounding && (
                    <p className="mt-1 text-[12px] text-bone-muted">
                      Need more than ${FREE_BUDGET_CAP}?{" "}
                      <a
                        href={stripeHref}
                        className="text-sage-soft underline-offset-2 hover:text-bone hover:underline"
                      >
                        Unlimited with {FOUNDING_PLAN_LABEL}
                      </a>
                    </p>
                  )}
                  {isOverBudget && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const suggested = showFullOutlook
                            ? Math.ceil(projected / 10) * 10
                            : Math.ceil(spent / 10) * 10;
                          applySuggestedBudget(suggested);
                        }}
                        className="rounded-full border border-hairline px-3 py-1 text-[12px] text-sage-soft transition hover:text-bone"
                      >
                        Raise budget
                      </button>
                      <button
                        type="button"
                        onClick={hideAllUnset}
                        className="rounded-full border border-hairline px-3 py-1 text-[12px] text-bone-muted transition hover:text-bone"
                      >
                        Hide unused tools
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Tools tracked</Eyebrow>
              <span className="rounded-full bg-sage/20 px-2.5 py-1 text-[11px] font-medium text-mint">
                {isFounding
                  ? `${trackedCount} set`
                  : `${trackedCount}/${FREE_TOOL_LIMIT} free`}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">{trackedCount}</span>
              <span className="text-sm text-bone-muted">
                {isFounding ? `visible ${visibleTools.length}` : `of ${FREE_TOOL_LIMIT} free`}
              </span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              {trackedCount === 0
                ? `Track up to ${FREE_TOOL_LIMIT} tools free — then ToRay Pro for your full stack.`
                : !isFounding && trackedCount >= FREE_TOOL_LIMIT
                  ? `Free limit reached. Unlimited tools with ${FOUNDING_PLAN_LABEL} — $12/mo.`
                  : !isFounding
                    ? `${FREE_TOOL_LIMIT - trackedCount} free slot${FREE_TOOL_LIMIT - trackedCount === 1 ? "" : "s"} left. Full stacks need ToRay Pro.`
                    : "Hide presets you don’t use so this stays your dashboard."}
            </p>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Month-end outlook</Eyebrow>
              <span className="rounded-full bg-bone/10 px-2.5 py-1 text-[11px] font-medium text-bone-muted">
                by {monthEnd}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              {showFullOutlook ? (
                <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">
                  ${hasSpend ? projected.toFixed(0) : "0"}
                </span>
              ) : (
                <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone/40 blur-[6px] select-none">
                  ${hasSpend ? projected.toFixed(0) : "128"}
                </span>
              )}
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              {!showFullOutlook
                ? foundingUpgradeHint("Month-end outlook")
                : !hasSpend
                  ? "Fixed plans stay flat. Usage-based spend is paced to month-end."
                  : `$${fixedTracked.toFixed(0)} fixed + usage paced from $${usageTracked.toFixed(0)} so far.`}
            </p>
            {!showFullOutlook && (
              <a
                href={stripeHref}
                className="mt-3 inline-flex text-[12px] text-sage-soft underline-offset-2 hover:text-bone hover:underline"
              >
                Unlock outlook — ToRay Pro · $12/mo
              </a>
            )}
          </div>
        </section>

        <section className="mt-4">
          <div
            className={`rounded-[28px] border p-6 md:p-7 ${
              showStackPulse
                ? "border-sage/35 bg-gradient-to-r from-sage/15 to-surface"
                : "border-hairline bg-surface"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Eyebrow>Stack Pulse</Eyebrow>
              <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">
                {showStackPulse ? "Pro" : "Pro preview"}
              </span>
            </div>
            {showStackPulse ? (
              <>
                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-[12px] text-bone-muted">Daily burn</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      ${hasSpend ? stackPulse.dailyBurn.toFixed(2) : "0.00"}
                      <span className="text-sm text-bone-muted"> /day</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-bone-muted">Top tool share</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      {stackPulse.topTool
                        ? `${stackPulse.topShare}%`
                        : "—"}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-bone-muted">
                      {stackPulse.topTool ?? "Track a tool to see mix"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-bone-muted">Budget pace</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      {stackPulse.daysUntilBudget != null
                        ? `Day ${stackPulse.daysUntilBudget}`
                        : "—"}
                    </p>
                    <p className="mt-0.5 text-[12px] text-bone-muted">
                      {budgetBasis ? "Hit budget at this burn" : "Set a budget"}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-bone-muted">
                  {stackPulse.paceLabel}
                </p>
              </>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-1 gap-4 blur-[5px] select-none sm:grid-cols-3">
                  <div>
                    <p className="text-[12px] text-bone-muted">Daily burn</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      $12.40
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-bone-muted">Top tool share</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      48%
                    </p>
                  </div>
                  <div>
                    <p className="text-[12px] text-bone-muted">Budget pace</p>
                    <p className="mt-1 font-serif text-2xl tabular-nums text-bone">
                      Day 22
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-bone-muted">
                  See which tool is eating the month, your $/day burn, and when
                  you&apos;ll hit budget — exclusive to {FOUNDING_PLAN_LABEL}.
                </p>
                <a
                  href={stripeHref}
                  className="mt-3 inline-flex rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
                >
                  Unlock Stack Pulse — $12/mo
                </a>
              </>
            )}
          </div>
        </section>

        {trackedCount >= 2 && !isLoggedIn && (
          <div className="mt-6 rounded-[24px] border border-sage/30 bg-sage/10 px-5 py-4 md:px-6">
            <p className="font-serif text-lg text-bone">
              Nice — ${spent.toFixed(0)} across {trackedCount} tools on this device.
            </p>
            <p className="mt-1 text-sm text-bone-muted">
              Sign in free to back up those tools to your email. Same Free
              limits — Pro (outlook, Stack Pulse, unlimited tools) is a separate
              upgrade.
            </p>
            <button
              type="button"
              onClick={openSignIn}
              className="mt-3 rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
            >
              Back up free
            </button>
          </div>
        )}

        {trackedCount >= 2 && !isFounding && (
          <div className="mt-6 rounded-[24px] border border-clay/35 bg-clay/10 px-5 py-4 md:px-6">
            <p className="font-serif text-lg text-bone">
              {trackedCount >= FREE_TOOL_LIMIT
                ? "To run your full stack, you need ToRay Pro"
                : "You&apos;re building a real stack — ToRay Pro is next"}
            </p>
            <p className="mt-1 text-sm text-bone-muted">
              Free stops at {FREE_TOOL_LIMIT} tools and ${FREE_BUDGET_CAP} budgets,
              and hides outlook, Stack Pulse, CSV, and Gemini/Grok Vision.{" "}
              {FOUNDING_PLAN_LABEL} at $12/mo unlocks the rest.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={stripeHref}
                className="rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
              >
                {FOUNDING_CTA_LABEL}
              </a>
              <button
                type="button"
                onClick={exportCsv}
                className="rounded-full border border-hairline px-4 py-2 text-sm text-bone-muted transition hover:text-bone"
              >
                Export CSV (Pro)
              </button>
            </div>
          </div>
        )}

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8 lg:col-span-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Eyebrow>Your AI tools</Eyebrow>
              <div className="flex flex-wrap items-center gap-3">
                {hiddenUnsetCount > 0 && (
                  <button
                    type="button"
                    onClick={showHiddenTools}
                    className="text-sm text-bone-muted transition hover:text-bone"
                  >
                    Show hidden ({hiddenUnsetCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={hideAllUnset}
                  className="inline-flex items-center gap-1 text-sm text-bone-muted transition hover:text-bone"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide unset
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openManualCorrection("", undefined, null, { custom: true })
                  }
                  className="inline-flex items-center gap-1 text-sm text-sage-soft transition hover:text-bone"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add tool
                </button>
              </div>
            </div>
            <p className="mt-2 text-[12px] text-bone-muted">
              {isFounding
                ? "Tracked tools stay on top. Hide the rest — or add any name you pay for."
                : `Free tracks ${FREE_TOOL_LIMIT} tools. Add more with ${FOUNDING_PLAN_LABEL}.`}
            </p>

            {!hasSpend && (
              <div className="mt-4 flex flex-wrap gap-2">
                {QUICK_START_TOOLS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      if (hiddenTools.includes(name)) {
                        persistPrefs({
                          hiddenTools: hiddenTools.filter((item) => item !== name),
                        });
                      }
                      openManualCorrection(name);
                    }}
                    className="rounded-full border border-hairline bg-background/50 px-3 py-1.5 text-[12px] text-bone-muted transition hover:border-sage-soft/40 hover:text-bone"
                  >
                    + {name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    openManualCorrection("", undefined, null, { custom: true })
                  }
                  className="rounded-full border border-sage/40 bg-sage/10 px-3 py-1.5 text-[12px] text-sage-soft transition hover:text-bone"
                >
                  + Custom tool
                </button>
              </div>
            )}

            <ul className="mt-5 space-y-3">
              {visibleTools.map((service) => {
                const savedAmount = serviceAmounts[service.name];
                const isSet = savedAmount !== undefined;
                return (
                  <li key={service.name}>
                    <div className="flex items-stretch gap-2 rounded-2xl bg-surface-raised/70 transition duration-180 hover:bg-surface-raised hover:ring-1 hover:ring-sage-soft/30">
                      <button
                        type="button"
                        onClick={() =>
                          openManualCorrection(
                            service.name,
                            savedAmount,
                            service.isUsageBased ? null : "Monthly subscription",
                          )
                        }
                        className="flex min-w-0 flex-1 items-center gap-4 px-4 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
                      >
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-serif text-sm ${service.accent}`}
                        >
                          {service.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-bone">
                              {service.name}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                                isSet ? "bg-mint/15 text-mint" : "bg-bone/10 text-bone-muted"
                              }`}
                            >
                              {isSet ? "Tracked" : "Not set"}
                            </span>
                            {service.origin === "custom" && (
                              <span className="rounded-full bg-clay/15 px-2.5 py-0.5 text-[11px] font-medium text-clay">
                                Custom
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[13px] text-bone-muted">
                            {service.type}
                            {isSet
                              ? service.isUsageBased
                                ? " · This period"
                                : " · Monthly"
                              : service.suggestedAmount > 0
                                ? ` · Suggested $${service.suggestedAmount.toFixed(0)}`
                                : ""}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-medium tabular-nums text-bone">
                            {isSet ? `$${savedAmount.toFixed(2)}` : "—"}
                          </p>
                          <p className="inline-flex items-center gap-1 text-[11px] text-sage-soft">
                            <PencilLine className="h-3 w-3" />
                            {service.isUsageBased &&
                            (service.name === "OpenAI API" ||
                              service.name === "Anthropic API" ||
                              ((service.name === "Gemini API" ||
                                service.name === "Grok") &&
                                isFounding))
                              ? "Scan or edit"
                              : "Set amount"}
                          </p>
                        </div>
                      </button>
                      {!isSet && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            hideTool(service.name);
                          }}
                          className="shrink-0 self-center rounded-full p-2.5 text-bone-muted/70 transition hover:bg-bone/10 hover:text-bone"
                          aria-label={`Hide ${service.name}`}
                          title="Hide"
                        >
                          <EyeOff className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[28px] border border-hairline bg-surface p-6">
              <Eyebrow>Your data</Eyebrow>
              <p className="mt-3 text-sm leading-relaxed text-bone-muted">
                {isFounding
                  ? "Export tools, outlook, and update history anytime."
                  : `CSV export is included with ${FOUNDING_PLAN_LABEL} — $12/mo.`}
              </p>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!hasSpend && isFounding}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline px-4 py-2.5 text-sm font-medium text-bone transition hover:border-sage-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                {isFounding ? "Export CSV" : "Export CSV — Pro"}
              </button>
            </div>

            <div
              id="founding-member"
              className="rounded-[28px] border border-sage/40 bg-gradient-to-b from-sage/20 to-surface p-6 md:p-8"
            >
              <div className="flex items-center justify-between">
                <Eyebrow>
                  {isFounding ? FOUNDING_PLAN_LABEL : "To run your full stack"}
                </Eyebrow>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">
                  {isFounding ? "Active" : "$12/mo"}
                </span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-bone-muted">
                {isFounding
                  ? "Thank you — ToRay Pro is active. Unlimited tools & budget, Gemini/Grok Vision, outlook, Stack Pulse, and CSV are unlocked."
                  : `Free: OpenAI/Anthropic Vision, ${FREE_TOOL_LIMIT} tools, budgets up to $${FREE_BUDGET_CAP}/mo. ${FOUNDING_PLAN_LABEL} unlocks the full operating view of your stack.`}
              </p>
              {foundingVerifyMessage && (
                <p className="mt-3 rounded-2xl border border-mint/30 bg-mint/10 px-3 py-2 text-[13px] text-mint">
                  {foundingVerifyMessage}
                </p>
              )}
              <ul className="mt-5 space-y-3">
                {PRO_FEATURES.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage/30">
                      <Check className="h-3 w-3 text-mint" strokeWidth={2.5} />
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-bone/90">{text}</span>
                    <Icon className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-sage-soft/50" />
                  </li>
                ))}
              </ul>
              <div className="mt-7 space-y-3">
                {!isFounding && (
                  <a
                    href={stripeHref}
                    className="flex w-full items-center justify-center rounded-full bg-sage px-6 py-3 text-sm font-semibold text-bone transition hover:bg-sage-glow"
                  >
                    {FOUNDING_CTA_LABEL}
                  </a>
                )}
                <p className="text-center text-[11px] text-bone-muted">
                  {isFounding
                    ? "Verified via Stripe · full stack unlocked"
                    : "Secure checkout via Stripe · same email as Magic Link"}
                </p>
                {!isLoggedIn && (
                  <button
                    type="button"
                    onClick={openSignIn}
                    className="flex w-full items-center justify-center rounded-full border border-hairline px-6 py-3 text-sm font-medium text-bone-muted transition hover:border-sage-soft/40 hover:text-bone"
                  >
                    Sign in free to back up first
                  </button>
                )}
                {!isFounding && isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          const response = await fetch("/api/founding/status");
                          const result = (await response.json()) as {
                            isFounding?: boolean;
                          };
                          if (result.isFounding) {
                            setIsFounding(true);
                            writeFounding(true);
                            setFoundingVerifyMessage(
                              "ToRay Pro verified for this account.",
                            );
                          } else {
                            setFoundingVerifyMessage(
                              "No verified checkout for this email yet. Complete Stripe with the same address, or wait a moment and refresh.",
                            );
                          }
                        } catch {
                          setFoundingVerifyMessage(
                            "Could not check Pro status. Try again in a moment.",
                          );
                        }
                      })();
                    }}
                    className="w-full text-center text-[11px] text-bone-muted underline-offset-2 hover:text-bone hover:underline"
                  >
                    Already checked out? Refresh Pro status
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex h-16 max-w-6xl flex-col items-start justify-center gap-1 px-6 text-[12px] text-bone-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 ToRay</span>
          <span>Screenshots aren&apos;t stored. Totals stay local until you sign in.</span>
        </div>
      </footer>

      {isManualCorrectionOpen && (
        <ManualCorrectionModal
          amount={manualAmount}
          period={manualPeriod}
          service={manualService}
          serviceOptions={serviceOptions}
          isCustomMode={isCustomMode}
          customName={customName}
          isUsageBased={manualUsageBased}
          onAmountChange={setManualAmount}
          onPeriodChange={setManualPeriod}
          onServiceChange={(name) => {
            setManualService(name);
            const tool = findTool(name);
            setManualUsageBased(tool?.isUsageBased ?? true);
            if (serviceAmounts[name] !== undefined) {
              setManualAmount(serviceAmounts[name].toFixed(2));
            } else if (tool) {
              setManualAmount(tool.suggestedAmount.toFixed(2));
            }
          }}
          onCustomModeChange={setIsCustomMode}
          onCustomNameChange={setCustomName}
          onUsageBasedChange={setManualUsageBased}
          onClose={() => setIsManualCorrectionOpen(false)}
          onSave={saveManualCorrection}
          canClear={
            serviceAmounts[
              isCustomMode ? customName.trim() || manualService : manualService
            ] !== undefined
          }
          onClear={() =>
            clearTrackedTool(
              isCustomMode ? customName.trim() || manualService : manualService,
            )
          }
          canDeleteCustom={
            !isCustomMode &&
            customTools.some(
              (tool) =>
                tool.name.toLowerCase() === manualService.toLowerCase(),
            )
          }
          onDeleteCustom={() => deleteCustomTool(manualService)}
          error={manualError}
        />
      )}

      {isSignInOpen && !isLoggedIn && (
        <SignInModal
          email={waitlistEmail}
          onEmailChange={setWaitlistEmail}
          submitted={waitlistSubmitted}
          isSubmitting={isWaitlistSubmitting}
          onSubmit={handleWaitlistSubmit}
          error={waitlistError}
          onClose={() => setIsSignInOpen(false)}
        />
      )}
    </div>
  );
}
