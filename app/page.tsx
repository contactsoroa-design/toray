"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Check,
  Download,
  EyeOff,
  ImagePlus,
  LogOut,
  MessageSquareText,
  PencilLine,
  Plus,
  Radar,
  ScanLine,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { FeedbackModal } from "@/components/FeedbackModal";
import type { FeedbackContext } from "@/lib/feedback";
import {
  applyHistoryToDashboard,
  clearAllRemovedServices,
  clearServiceRemoved,
  deleteBillingScansForService,
  fetchUserBillingScans,
  filterRemovedServices,
  insertBillingScan,
  isValidServiceName,
  markServiceRemoved,
  mergeBillingScanHistories,
  PRESET_SERVICES,
  readRemovedServices,
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
  canManageCustomTools,
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
  foundingVisionUnlockLabel,
  visionProviderToToolName,
} from "@/lib/vision-providers";
import {
  identifyMetaUser,
  trackMetaCustom,
  trackScanComplete,
} from "@/lib/meta-pixel";
import { createClient } from "@/lib/supabase/client";

const INITIAL_SPENT = 0;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const SAMPLE_BILL_PATH = "/sample-openai-billing.png";
const SCAN_HISTORY_KEY = "toray-billing-scans";

type ScanSource = "upload" | "sample";
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
/** track = set amount on existing tool; add/edit = manage custom catalog entries */
type ManualModalMode = "track" | "add_custom" | "edit_custom";

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
    text: `Custom tools + unlimited presets (Free: ${FREE_TOOL_LIMIT} presets only)`,
  },
  {
    icon: ScanLine,
    text: "Pro Vision — Gemini, Grok, Cursor, Copilot billing screenshots",
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
  const displayRef = useRef(target);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    // Snap to zero so removals never leave a stale animated total.
    if (target === 0) {
      fromRef.current = 0;
      displayRef.current = 0;
      setDisplay(0);
      return;
    }

    const from = displayRef.current;
    fromRef.current = from;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const value = from + (target - from) * easeOutCubic(progress);
      displayRef.current = value;
      setDisplay(value);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        displayRef.current = target;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      fromRef.current = displayRef.current;
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
                Does not unlock Outlook, Stack Pulse, or Pro Vision
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
  mode,
  amount,
  period,
  service,
  serviceOptions,
  customName,
  isUsageBased,
  canUseCustomTools,
  onAmountChange,
  onPeriodChange,
  onServiceChange,
  onCustomNameChange,
  onUsageBasedChange,
  onSwitchToAddCustom,
  onSwitchToTrack,
  onClose,
  onSave,
  onClear,
  canClear,
  onDeleteCustom,
  canDeleteCustom,
  onRequestCustomUpgrade,
  error,
}: {
  mode: ManualModalMode;
  amount: string;
  period: string;
  service: ServiceName;
  serviceOptions: ServiceName[];
  customName: string;
  isUsageBased: boolean;
  canUseCustomTools: boolean;
  onAmountChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onServiceChange: (value: ServiceName) => void;
  onCustomNameChange: (value: string) => void;
  onUsageBasedChange: (value: boolean) => void;
  onSwitchToAddCustom?: () => void;
  onSwitchToTrack?: () => void;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClear?: () => void;
  canClear?: boolean;
  onDeleteCustom?: () => void;
  canDeleteCustom?: boolean;
  onRequestCustomUpgrade?: () => void;
  error: string | null;
}) {
  const isCustomForm = mode === "add_custom" || mode === "edit_custom";
  const title =
    mode === "add_custom"
      ? "Add a custom tool"
      : mode === "edit_custom"
        ? "Edit custom tool"
        : "Set the amount yourself";
  const subtitle =
    mode === "add_custom"
      ? "Creates a new tool in your list. Preset names can’t be reused — pick a unique name."
      : mode === "edit_custom"
        ? "Rename, change billing type, update the amount, or delete this custom tool."
        : canUseCustomTools
          ? "Pick a tool already on your list and set this period’s total. To create a new name, use Add custom tool."
          : "Pick from the free presets. Custom tool names unlock with ToRay Pro.";
  const submitLabel =
    mode === "add_custom"
      ? "Add tool"
      : mode === "edit_custom"
        ? "Save changes"
        : "Save amount";

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
            <Eyebrow>
              {mode === "add_custom"
                ? "Add"
                : mode === "edit_custom"
                  ? "Edit"
                  : "Track"}
            </Eyebrow>
            <h2
              id="manual-correction-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              {subtitle}
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
            <span>{isCustomForm ? "Tool name" : "Service"}</span>
            {isCustomForm ? (
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
                {mode === "add_custom" && onSwitchToTrack && (
                  <button
                    type="button"
                    onClick={onSwitchToTrack}
                    className="mt-1 justify-self-start text-[13px] text-sage-soft underline-offset-4 hover:underline"
                  >
                    Track an existing tool instead
                  </button>
                )}
              </>
            ) : (
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
                {canUseCustomTools ? (
                  <button
                    type="button"
                    onClick={onSwitchToAddCustom}
                    className="mt-1 justify-self-start text-[13px] text-sage-soft underline-offset-4 hover:underline"
                  >
                    + Add a new custom tool
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRequestCustomUpgrade}
                    className="mt-1 justify-self-start text-[13px] text-sage-soft underline-offset-4 hover:underline"
                  >
                    + Custom tool — ToRay Pro
                  </button>
                )}
              </>
            )}
          </div>

          {isCustomForm && (
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
          )}

          <label className="grid gap-1.5 text-sm text-bone-muted">
            Current-period total (USD)
            {mode === "add_custom" && (
              <span className="font-normal text-bone-muted/60">
                {" "}
                — optional; leave blank to add without tracking spend yet
              </span>
            )}
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
              {submitLabel}
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
  const [manualModalMode, setManualModalMode] =
    useState<ManualModalMode>("track");
  const [customName, setCustomName] = useState("");
  /** Original name when editing a custom tool (for rename). */
  const [editingCustomOriginal, setEditingCustomOriginal] = useState<
    string | null
  >(null);
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
  const [feedbackContext, setFeedbackContext] =
    useState<FeedbackContext | null>(null);
  const cloudHydratedForRef = useRef<string | null>(null);
  const clearingDeviceOnSignOutRef = useRef(false);

  const allowCustomTools = canManageCustomTools(isFounding);

  const catalog: ToolDef[] = (() => {
    const base: ToolDef[] = [
      ...PRESET_TOOLS,
      ...(allowCustomTools
        ? customTools.map((tool, index) => toolFromCustom(tool, index))
        : []),
    ];
    const known = new Set(base.map((tool) => tool.name));
    // Always surface tracked orphans (e.g. leftover custom rows on Free) so
    // their spend stays visible and removable — not a ghost $20 in This month.
    const extras: ToolDef[] = Object.keys(serviceAmounts)
      .filter((name) => !known.has(name))
      .map((name, index) => ({
        name,
        type: allowCustomTools ? "Custom" : "Tracked",
        suggestedAmount: 0,
        isUsageBased: true,
        accent: CUSTOM_ACCENTS[index % CUSTOM_ACCENTS.length],
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

  // Single source of truth: never keep a parallel spent counter (it can desync on remove).
  const spent =
    Math.round(
      Object.values(serviceAmounts).reduce((sum, amount) => sum + amount, 0) *
        100,
    ) / 100;
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
  // Free plan only counts presets toward the tool cap (custom names are Pro-only).
  const trackedCount = isFounding
    ? Object.keys(serviceAmounts).length
    : Object.keys(serviceAmounts).filter((name) =>
        (PRESET_SERVICES as readonly string[]).includes(name),
      ).length;
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
    _nextSpent: number,
    nextAmounts: Record<string, number>,
  ) {
    setScanHistory(history);
    setServiceAmounts(nextAmounts);
    const newest = history[0]?.scannedAt;
    if (newest) {
      setLastSyncedAt(formatClock(new Date(newest)));
    }
  }

  useEffect(() => {
    // Intentional client-only hydrate from localStorage (no SSR equivalent).
    const local = readLocalPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount hydrate from device prefs
    setBudget(clampBudgetForPlan(false, local.budget));
    setHiddenTools(local.hiddenTools);
    setCustomTools(local.customTools);
    // Pro is never granted from cache alone — founding_members via /api/founding/status.
    setIsFounding(false);
    if (local.isFounding) writeFounding(false);

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
          if (result.matchesSignedInUser) {
            setIsFounding(true);
            writeFounding(true);
            setFoundingVerifyMessage(
              "ToRay Pro verified — Pro Vision providers are unlocked.",
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
        // Logged out: Free only — never keep a stale Pro cache.
        setIsFounding(false);
        writeFounding(false);
        return false;
      } catch {
        // Keep UI Free if the status endpoint is unavailable.
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
      identifyMetaUser(user.email);
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

      const foundingNow = (await refreshFoundingStatus()) ?? false;
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

      const removedServices = readRemovedServices();
      const localHistory = filterRemovedServices(
        readLocalHistory(),
        removedServices,
      );
      setCloudSyncStatus("syncing");
      try {
        const remoteHistory = await fetchUserBillingScans(supabase);
        const merged = mergeBillingScanHistories(
          localHistory,
          remoteHistory,
          removedServices,
        );
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
      const removedServices = readRemovedServices();
      const localHistory = filterRemovedServices(
        readLocalHistory(),
        removedServices,
      );
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
      } else {
        // Ensure a prior remove isn't overwritten by stale in-memory defaults.
        applyDashboardState([], INITIAL_SPENT, {});
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
        identifyMetaUser(null);
        setIsFounding(false);
        writeFounding(false);
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

  function openFeedback(context: FeedbackContext) {
    setFeedbackContext(context);
  }

  function resetDeviceDashboard() {
    window.localStorage.removeItem(SCAN_HISTORY_KEY);
    clearAllRemovedServices();
    const { hiddenTools: starterHidden } = clearLocalAccountData();
    setScanHistory([]);
    setServiceAmounts({});
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
    identifyMetaUser(null);
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

    clearServiceRemoved(scan.service);
    setServiceAmounts((current) => ({
      ...current,
      [scan.service]: scan.amountUsd,
    }));
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
    const target = name.trim().toLowerCase();
    const matchedKey = Object.keys(serviceAmounts).find(
      (key) => key.toLowerCase() === target,
    );
    const historyMatches = scanHistory.some(
      (scan) => scan.service.toLowerCase() === target,
    );
    if (matchedKey === undefined && !historyMatches) return;

    // Prevent cloud/local merge from resurrecting this service after remove.
    markServiceRemoved(matchedKey ?? name);

    setServiceAmounts((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) {
        if (key.toLowerCase() === target) delete next[key];
      }
      return next;
    });
    setScanHistory((current) => {
      const next = current.filter(
        (scan) => scan.service.toLowerCase() !== target,
      );
      window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
    markUpdated();
    setScanStatus("success");
    setScanMessage(`${name} removed from this month’s total`);
    setIsManualCorrectionOpen(false);

    const supabase = supabaseRef.current;
    if (supabase && isLoggedIn) {
      const cloudName = matchedKey ?? name;
      setCloudSyncStatus("syncing");
      void deleteBillingScansForService(supabase, cloudName)
        .then(() => {
          setCloudSyncStatus("synced");
          window.setTimeout(() => setCloudSyncStatus("idle"), 2500);
        })
        .catch(() => setCloudSyncStatus("error"));
    }
  }

  function isPresetName(name: string): boolean {
    const lower = name.trim().toLowerCase();
    return (PRESET_SERVICES as readonly string[]).some(
      (preset) => preset.toLowerCase() === lower,
    );
  }

  function findCustomTool(name: string): CustomToolPref | undefined {
    const lower = name.trim().toLowerCase();
    return customTools.find((tool) => tool.name.toLowerCase() === lower);
  }

  function deleteCustomTool(name: ServiceName) {
    if (!canManageCustomTools(isFounding)) {
      promptFoundingUpgrade(foundingUpgradeHint("Custom tools"));
      return;
    }
    if (!findCustomTool(name)) return;

    const target = name.trim().toLowerCase();
    const hasTrackedAmount = Object.keys(serviceAmounts).some(
      (key) => key.toLowerCase() === target,
    );
    const hasHistory = scanHistory.some(
      (scan) => scan.service.toLowerCase() === target,
    );

    persistPrefs({
      customTools: customTools.filter(
        (tool) => tool.name.toLowerCase() !== target,
      ),
      hiddenTools: hiddenTools.filter(
        (item) => item.toLowerCase() !== target,
      ),
    });

    if (hasTrackedAmount || hasHistory) {
      clearTrackedTool(name);
      setScanMessage(`${name} deleted from your tools`);
      return;
    }

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
    options?: { mode?: ManualModalMode },
  ) {
    const requestedMode = options?.mode ?? "track";

    if (
      (requestedMode === "add_custom" || requestedMode === "edit_custom") &&
      !canManageCustomTools(isFounding)
    ) {
      promptFoundingUpgrade(foundingUpgradeHint("Custom tools"));
      return;
    }

    if (requestedMode === "add_custom") {
      setManualModalMode("add_custom");
      setEditingCustomOriginal(null);
      setCustomName("");
      setManualService("OpenAI API");
      setManualUsageBased(true);
      setManualAmount("");
      setManualPeriod("");
      setManualError(null);
      setIsManualCorrectionOpen(true);
      return;
    }

    const resolvedService = service || "OpenAI API";
    const existingCustom = findCustomTool(resolvedService);
    const mode: ManualModalMode =
      requestedMode === "edit_custom" ||
      (requestedMode === "track" &&
        existingCustom &&
        canManageCustomTools(isFounding))
        ? "edit_custom"
        : "track";

    if (
      mode === "track" &&
      wouldExceedFreeToolLimit(
        isFounding,
        trackedCount,
        resolvedService,
        serviceAmounts,
      )
    ) {
      promptFoundingUpgrade(freeToolLimitMessage(trackedCount));
      return;
    }

    const tool = findTool(resolvedService);
    const suggested = tool?.suggestedAmount ?? 0;
    const currentAmount =
      amount ?? serviceAmounts[resolvedService] ?? suggested;

    setManualModalMode(mode);
    if (mode === "edit_custom") {
      setEditingCustomOriginal(resolvedService);
      setCustomName(resolvedService);
      setManualUsageBased(
        existingCustom?.isUsageBased ?? tool?.isUsageBased ?? true,
      );
    } else {
      setEditingCustomOriginal(null);
      setCustomName("");
      setManualUsageBased(tool?.isUsageBased ?? true);
    }
    setManualService(resolvedService);
    setManualAmount(
      amount !== undefined || serviceAmounts[resolvedService] !== undefined
        ? currentAmount.toFixed(2)
        : suggested > 0
          ? suggested.toFixed(2)
          : "",
    );
    setManualPeriod(period ?? "");
    setManualError(null);
    setIsManualCorrectionOpen(true);
  }

  function renameTrackedService(from: string, to: string) {
    if (from === to) return;

    const amount = serviceAmounts[from];
    if (amount !== undefined) {
      setServiceAmounts((current) => {
        const next = { ...current };
        delete next[from];
        next[to] = amount;
        return next;
      });
    }

    setScanHistory((current) => {
      const next = current.map((scan) =>
        scan.service === from ? { ...scan, service: to } : scan,
      );
      window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next));
      return next;
    });

    if (hiddenTools.includes(from) || hiddenTools.includes(to)) {
      persistPrefs({
        hiddenTools: [
          ...hiddenTools.filter(
            (name) =>
              name.toLowerCase() !== from.toLowerCase() &&
              name.toLowerCase() !== to.toLowerCase(),
          ),
          ...(hiddenTools.some((name) => name.toLowerCase() === from.toLowerCase())
            ? [to]
            : []),
        ],
      });
    }

    const supabase = supabaseRef.current;
    if (supabase && isLoggedIn && amount !== undefined) {
      setCloudSyncStatus("syncing");
      void deleteBillingScansForService(supabase, from)
        .then(() =>
          insertBillingScan(supabase, {
            id: crypto.randomUUID(),
            service: to,
            amountUsd: amount,
            billingPeriod: manualPeriod.trim() || null,
            confidence: "high",
            scannedAt: new Date().toISOString(),
          }),
        )
        .then(() => {
          setCloudSyncStatus("synced");
          window.setTimeout(() => setCloudSyncStatus("idle"), 2500);
        })
        .catch(() => setCloudSyncStatus("error"));
    }
  }

  function saveManualCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (manualModalMode === "add_custom" || manualModalMode === "edit_custom") {
      if (!canManageCustomTools(isFounding)) {
        setManualError(foundingUpgradeHint("Custom tools"));
        promptFoundingUpgrade(foundingUpgradeHint("Custom tools"));
        return;
      }

      const resolvedName = customName.trim();
      if (!isValidServiceName(resolvedName)) {
        setManualError("Enter a tool name (1–64 characters).");
        return;
      }
      if (isPresetName(resolvedName)) {
        setManualError(
          "That name is a built-in preset. Choose a different custom name.",
        );
        return;
      }

      const amountText = manualAmount.trim();
      const hasAmount = amountText.length > 0;
      const amount = hasAmount ? Number.parseFloat(amountText) : null;
      if (hasAmount && (!Number.isFinite(amount) || (amount as number) < 0)) {
        setManualError("Enter a valid USD amount of zero or more.");
        return;
      }

      if (manualModalMode === "add_custom") {
        if (findCustomTool(resolvedName)) {
          setManualError("You already have a custom tool with that name.");
          return;
        }
        if (
          hasAmount &&
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

        persistPrefs({
          customTools: [
            ...customTools,
            {
              name: resolvedName,
              isUsageBased: manualUsageBased,
              suggestedAmount: amount ?? 0,
            },
          ],
          hiddenTools: hiddenTools.filter(
            (name) => name.toLowerCase() !== resolvedName.toLowerCase(),
          ),
        });

        if (hasAmount && amount != null) {
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
          setScanMessage(
            `${resolvedName} added · $${amount.toFixed(2)} tracked`,
          );
        } else {
          setScanMessage(`${resolvedName} added to your tools`);
        }
        setScanStatus("success");
        setIsManualCorrectionOpen(false);
        return;
      }

      // edit_custom
      const original = editingCustomOriginal;
      if (!original || !findCustomTool(original)) {
        setManualError("This custom tool is no longer available.");
        return;
      }

      const nameChanged =
        original.toLowerCase() !== resolvedName.toLowerCase();
      if (nameChanged && findCustomTool(resolvedName)) {
        setManualError("You already have a custom tool with that name.");
        return;
      }

      if (
        hasAmount &&
        nameChanged &&
        wouldExceedFreeToolLimit(
          isFounding,
          trackedCount,
          resolvedName,
          serviceAmounts,
        )
      ) {
        // Renaming onto a new key shouldn't trip the free limit for Pro, but keep guard.
        setManualError(freeToolLimitMessage(trackedCount));
        return;
      }

      const nextCustom = customTools.map((tool) =>
        tool.name.toLowerCase() === original.toLowerCase()
          ? {
              name: resolvedName,
              isUsageBased: manualUsageBased,
              suggestedAmount: amount ?? tool.suggestedAmount,
            }
          : tool,
      );
      persistPrefs({ customTools: nextCustom });

      if (nameChanged) {
        renameTrackedService(original, resolvedName);
      }

      if (hasAmount && amount != null) {
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
        setScanMessage(
          `${resolvedName} updated · $${amount.toFixed(2)} saved`,
        );
      } else {
        setScanMessage(`${resolvedName} updated`);
      }
      setScanStatus("success");
      setIsManualCorrectionOpen(false);
      return;
    }

    // track mode — amount on an existing catalog tool only
    const resolvedName = manualService.trim();
    if (!isValidServiceName(resolvedName)) {
      setManualError("Pick a tool from the list.");
      return;
    }

    const amount = Number.parseFloat(manualAmount);
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

    if (hiddenTools.includes(resolvedName)) {
      persistPrefs({
        hiddenTools: hiddenTools.filter((name) => name !== resolvedName),
      });
    }

    const tool = findTool(resolvedName);
    const saved = saveBillingScan({
      id: crypto.randomUUID(),
      service: resolvedName,
      amountUsd: Math.round(amount * 100) / 100,
      billingPeriod:
        manualPeriod.trim() ||
        (tool && !tool.isUsageBased ? "Monthly subscription" : null),
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

  async function runBillingScan(
    file: File,
    options: { source?: ScanSource } = {},
  ) {
    const source: ScanSource = options.source ?? "upload";

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
        const hinted = isVisionProvider(result.service)
          ? foundingVisionUnlockLabel(result.service)
          : "Gemini API";
        setScanStatus("error");
        setScanMessage(
          result.error ??
            "Pro Vision (Gemini, Grok, Cursor, Copilot) is included with ToRay Pro — $12/mo. Enter the amount manually within your free tool limit, or upgrade.",
        );
        openManualCorrection(
          hinted,
          typeof result.amountUsd === "number" ? result.amountUsd : undefined,
          result.billingPeriod ?? null,
        );
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
        const fallback = isFounding
          ? "This does not look like a clear supported billing screen. Use Add tool to enter any provider manually."
          : "This does not look like a clear supported billing screen. Set a preset amount, or upgrade for custom tools.";
        throw new Error(result.error ?? fallback);
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
        source === "sample"
          ? `Sample · ${serviceName} · $${amountUsd.toFixed(2)} — now try your own screenshot`
          : `${serviceName} · $${amountUsd.toFixed(2)} saved to your dashboard`,
      );
      trackScanComplete({
        source,
        service: serviceName,
        amountUsd,
        email: userEmail,
      });
    } catch (error) {
      setScanStatus("error");
      setScanMessage(
        error instanceof Error
          ? error.message
          : "The billing scanner could not analyze this image.",
      );
      openManualCorrection("OpenAI API");
    }
  }

  async function runSampleScan() {
    if (isScanning) return;
    trackMetaCustom("SampleScanClick");
    document
      .getElementById("quick-scan")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    try {
      const response = await fetch(SAMPLE_BILL_PATH);
      if (!response.ok) {
        throw new Error("Could not load the sample bill");
      }
      const blob = await response.blob();
      const type = blob.type || "image/png";
      const file = new File([blob], "sample-openai-billing.png", { type });
      await runBillingScan(file, { source: "sample" });
    } catch (error) {
      setScanStatus("error");
      setScanMessage(
        error instanceof Error
          ? error.message
          : "Could not load the sample bill",
      );
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void runBillingScan(file, { source: "upload" });
    event.target.value = "";
  }

  function pickScreenshot() {
    if (isScanning) return;
    fileInputRef.current?.click();
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isScanning) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void runBillingScan(file, { source: "upload" });
  }

  const visionSupportCopy = isFounding
    ? "OpenAI, Anthropic, Gemini, Grok, Cursor, or Copilot billing — Vision unlocked."
    : `OpenAI / Anthropic Vision free · up to ${FREE_TOOL_LIMIT} presets. Pro Vision + unlimited tools with ToRay Pro.`;

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
        <div className="mx-auto flex h-[64px] max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
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
            <button
              type="button"
              onClick={() => openFeedback("header")}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:text-bone"
              aria-label="Send feedback"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Feedback</span>
            </button>
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

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-24 sm:px-6">
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
                    CSV, and Pro Vision (Gemini/Grok/Cursor/Copilot).
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {authNotice?.toLowerCase().includes("sign-in") ||
                authNotice?.toLowerCase().includes("magic link") ||
                authNotice?.toLowerCase().includes("expired") ? (
                  <button
                    type="button"
                    onClick={() => openFeedback("sign_in")}
                    className="rounded-full border border-hairline px-3 py-1.5 text-[12px] text-sage-soft transition hover:text-bone"
                  >
                    Report sign-in issue
                  </button>
                ) : null}
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

        <section className="grid grid-cols-1 items-start gap-6 py-6 md:gap-8 md:py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
          <div>
            <Eyebrow>{isFounding ? "ToRay Pro Scanner" : "Free Instant Scanner"}</Eyebrow>
            <h1 className="mt-3 font-serif text-[2rem] font-medium leading-tight tracking-[-0.02em] text-bone sm:text-4xl md:text-5xl">
              Know your AI burn before your card does.
            </h1>
            <p className="mt-3 max-w-md text-[14px] leading-relaxed text-bone-muted sm:mt-4 sm:text-[15px]">
              {isFounding
                ? "Upload a usage screenshot — OpenAI, Anthropic, or Pro Vision (Gemini/Grok/Cursor/Copilot) — and see the dollar total in seconds."
                : "Upload an OpenAI or Anthropic usage screenshot — see the dollar total in seconds. No screenshot handy? Run the sample bill first."}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href="#quick-scan"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-sage px-5 text-[14px] font-semibold text-bone transition hover:bg-sage-glow"
              >
                Upload usage screenshot
              </a>
              {!isFounding && (
                <button
                  type="button"
                  onClick={() => void runSampleScan()}
                  disabled={isScanning}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-sage/45 px-5 text-[14px] font-medium text-sage-soft transition hover:border-sage-soft/60 hover:text-bone disabled:opacity-50"
                >
                  Try sample bill
                </button>
              )}
            </div>
            <p className="mt-3 hidden max-w-md text-[13px] text-bone-muted sm:block">
              {isFounding
                ? "Pro: unlimited tools & budget, Pro Vision, outlook, Stack Pulse, and CSV. Screenshots are analyzed securely and not stored."
                : `Free: up to ${FREE_TOOL_LIMIT} presets and $${FREE_BUDGET_CAP}/mo budget. Screenshots are analyzed securely and not stored. Totals stay on this device until you sign in.`}
            </p>
            <p className="mt-4 text-[13px] text-bone-muted sm:mt-6 sm:text-sm">
              {lastSyncedAt
                ? `Last update ${lastSyncedAt} · ${storageChip} · ${planChip}`
                : hasSpend
                  ? `Totals ready · ${storageChip} · ${planChip}`
                  : `Empty dashboard · ${storageChip} · ${planChip}`}
            </p>
          </div>

          <div id="quick-scan" className="rounded-[28px] border border-sage/35 bg-surface p-4 shadow-[0_20px_50px_rgba(0,0,0,0.25)] sm:p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <Eyebrow>Scan now</Eyebrow>
              <span className="max-w-[58%] text-right text-[11px] leading-snug text-mint sm:max-w-none sm:text-[12px]">
                {cloudSyncStatus === "syncing"
                  ? "Saving to cloud…"
                  : cloudSyncStatus === "error"
                    ? "Cloud save failed — kept on device"
                    : historyLabel}
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Mobile: thumb-friendly tap-to-select (no drag-and-drop chrome) */}
            <button
              type="button"
              onClick={pickScreenshot}
              disabled={isScanning}
              aria-label="Tap to select a billing screenshot"
              className={`relative mt-4 flex min-h-[220px] w-full flex-col items-center justify-center overflow-hidden rounded-[22px] border px-5 py-8 text-center transition duration-180 active:scale-[0.985] md:hidden ${
                isScanning
                  ? "pointer-events-none border-sage/40 bg-sage/10"
                  : "border-sage/45 bg-gradient-to-b from-sage/20 to-background/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
              }`}
            >
              {isScanning && (
                <span
                  aria-hidden
                  className="animate-toray-scan pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sage-soft to-transparent"
                />
              )}
              {isScanning ? (
                <ScanLoader stepIndex={scanStep} />
              ) : (
                <>
                  {previewUrl && scanStatus === "success" ? (
                    <div className="mb-4 overflow-hidden rounded-2xl border border-hairline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Uploaded usage screenshot"
                        className="h-20 w-36 object-cover opacity-90"
                      />
                    </div>
                  ) : (
                    <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-sage/25 ring-1 ring-sage-soft/30">
                      <ImagePlus className="h-7 w-7 text-sage-soft" strokeWidth={1.5} />
                    </div>
                  )}
                  <h2 className="font-serif text-[1.35rem] leading-snug tracking-[-0.02em] text-bone">
                    Tap to select screenshot
                  </h2>
                  <p className="mt-2 max-w-[18rem] text-[13px] leading-relaxed text-bone-muted">
                    {visionSupportCopy}
                  </p>
                  <span className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-sage px-7 text-[15px] font-semibold text-bone">
                    Choose from photos
                  </span>
                </>
              )}
            </button>

            {/* Desktop / tablet: keep the finished drag-and-drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!isScanning) setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative mt-4 hidden min-h-[240px] flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed px-5 text-center transition duration-180 md:flex ${
                isDragging
                  ? "border-sage-soft bg-sage/15"
                  : "border-hairline bg-background/40"
              } ${isScanning ? "pointer-events-none" : ""}`}
            >
              {isScanning && (
                <span
                  aria-hidden
                  className="animate-toray-scan pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sage-soft to-transparent"
                />
              )}

              {isScanning ? (
                <ScanLoader stepIndex={scanStep} />
              ) : (
                <>
                  {previewUrl && scanStatus === "success" ? (
                    <div className="mb-3 overflow-hidden rounded-2xl border border-hairline">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Uploaded usage screenshot"
                        className="h-16 w-28 object-cover opacity-80"
                      />
                    </div>
                  ) : (
                    <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-sage/20">
                      <ScanLine
                        className={`h-6 w-6 transition-colors ${
                          isDragging ? "text-sage-soft" : "text-sage-soft/70"
                        }`}
                        strokeWidth={1.5}
                      />
                    </div>
                  )}
                  <h2 className="mt-2 font-serif text-xl text-bone">
                    Drop a billing screenshot
                  </h2>
                  <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-bone-muted">
                    {visionSupportCopy}
                  </p>
                  <button
                    type="button"
                    onClick={pickScreenshot}
                    className="mt-5 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition hover:bg-sage-glow"
                  >
                    Choose file
                  </button>
                </>
              )}
            </div>

            <div className="mt-3 flex flex-col items-center gap-2 sm:mt-3">
              {!isFounding && (
                <button
                  type="button"
                  onClick={() => void runSampleScan()}
                  disabled={isScanning}
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-hairline px-4 text-[13px] font-medium text-bone-muted transition hover:border-sage/40 hover:text-bone disabled:opacity-50 md:min-h-0 md:py-2"
                >
                  No screenshot? Try sample OpenAI bill
                </button>
              )}
              <button
                type="button"
                onClick={() => openManualCorrection("Gemini API")}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 px-3 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline md:min-h-0"
              >
                <Plus className="h-3.5 w-3.5" />
                {isFounding ? "Add any tool manually" : "Set a preset amount"}
              </button>
            </div>

            {scanMessage && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
                <p
                  className={`text-[13px] leading-relaxed ${
                    scanStatus === "error"
                      ? "text-warning"
                      : scanStatus === "success"
                        ? "text-mint"
                        : "text-bone-muted"
                  }`}
                >
                  {scanMessage}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
                    className="inline-flex min-h-10 items-center gap-1 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline md:min-h-0"
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    {scanStatus === "success" ? "Correct amount" : "Enter manually"}
                  </button>
                  {scanStatus === "error" && (
                    <button
                      type="button"
                      onClick={() => openFeedback("scan_error")}
                      className="inline-flex min-h-10 items-center gap-1 text-[13px] text-bone-muted underline-offset-4 transition hover:text-bone hover:underline md:min-h-0"
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      Tell us what failed
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setScanMessage(null);
                      if (scanStatus === "success") setScanStatus("idle");
                    }}
                    className="inline-flex min-h-10 items-center text-[13px] text-bone-muted underline-offset-4 transition hover:text-bone hover:underline md:min-h-0"
                  >
                    Dismiss
                  </button>
                </div>
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
                      {" · "}
                      <button
                        type="button"
                        onClick={() => openFeedback("budget_cap")}
                        className="text-bone-muted underline-offset-2 hover:text-bone hover:underline"
                      >
                        Tell us why
                      </button>
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
                ? `Track up to ${FREE_TOOL_LIMIT} presets free — then ToRay Pro for custom tools and your full stack.`
                : !isFounding && trackedCount >= FREE_TOOL_LIMIT
                  ? `Free limit reached. Unlimited tools with ${FOUNDING_PLAN_LABEL} — $12/mo.`
                  : !isFounding
                    ? `${FREE_TOOL_LIMIT - trackedCount} free slot${FREE_TOOL_LIMIT - trackedCount === 1 ? "" : "s"} left. Full stacks need ToRay Pro.`
                    : "Hide presets you don’t use so this stays your dashboard."}
            </p>
            {!isFounding && trackedCount >= FREE_TOOL_LIMIT && (
              <button
                type="button"
                onClick={() => openFeedback("tool_limit")}
                className="mt-3 text-[12px] text-sage-soft underline-offset-2 hover:text-bone hover:underline"
              >
                Which tool did you need next?
              </button>
            )}
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Month-end outlook</Eyebrow>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  showFullOutlook
                    ? "bg-bone/10 text-bone-muted"
                    : "bg-sage/20 text-mint"
                }`}
              >
                {showFullOutlook ? `by ${monthEnd}` : "Pro"}
              </span>
            </div>
            {showFullOutlook ? (
              <>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">
                    ${hasSpend ? projected.toFixed(0) : "0"}
                  </span>
                </div>
                <p className="mt-6 text-sm leading-relaxed text-bone-muted">
                  {!hasSpend
                    ? "Fixed plans stay flat. Usage-based spend is paced to month-end."
                    : `$${fixedTracked.toFixed(0)} fixed + usage paced from $${usageTracked.toFixed(0)} so far.`}
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-relaxed text-bone-muted">
                  Project spend to {monthEnd} — unlocks with ToRay Pro.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <a
                    href={stripeHref}
                    className="inline-flex text-[12px] text-sage-soft underline-offset-2 hover:text-bone hover:underline"
                  >
                    Unlock outlook · $12/mo
                  </a>
                  <button
                    type="button"
                    onClick={() => openFeedback("outlook")}
                    className="inline-flex text-[12px] text-bone-muted underline-offset-2 hover:text-bone hover:underline"
                  >
                    What should it show?
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Pro: Stack Pulse stays above tools. Free: tools first (see compact Pulse below). */}
        {showStackPulse && (
          <section className="mt-4">
            <div className="rounded-[28px] border border-sage/35 bg-gradient-to-r from-sage/15 to-surface p-6 md:p-7">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Eyebrow>Stack Pulse</Eyebrow>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">
                  Pro
                </span>
              </div>
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
                    {stackPulse.topTool ? `${stackPulse.topShare}%` : "—"}
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
            </div>
          </section>
        )}

        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5 md:mt-8">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8 lg:col-span-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <Eyebrow>Your AI tools</Eyebrow>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {hiddenUnsetCount > 0 && (
                  <button
                    type="button"
                    onClick={showHiddenTools}
                    className="inline-flex min-h-10 items-center text-sm text-bone-muted transition hover:text-bone md:min-h-0"
                  >
                    Show hidden ({hiddenUnsetCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={hideAllUnset}
                  className="inline-flex min-h-10 items-center gap-1 text-sm text-bone-muted transition hover:text-bone md:min-h-0"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide unset
                </button>
                <button
                  type="button"
                  onClick={() =>
                    isFounding
                      ? openManualCorrection("", undefined, null, {
                          mode: "add_custom",
                        })
                      : openManualCorrection("OpenAI API")
                  }
                  className="inline-flex min-h-10 items-center gap-1 rounded-full border border-sage/35 bg-sage/10 px-3 text-sm text-sage-soft transition hover:text-bone md:min-h-0 md:rounded-none md:border-0 md:bg-transparent md:px-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {isFounding ? "Add custom tool" : "Track preset"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[12px] text-bone-muted">
              {isFounding
                ? "Tracked tools stay on top. Hide the rest — or add any name you pay for."
                : `Free tracks ${FREE_TOOL_LIMIT} presets. Custom names unlock with ${FOUNDING_PLAN_LABEL}.`}
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
                {isFounding ? (
                  <button
                    type="button"
                    onClick={() =>
                      openManualCorrection("", undefined, null, {
                        mode: "add_custom",
                      })
                    }
                    className="rounded-full border border-sage/40 bg-sage/10 px-3 py-1.5 text-[12px] text-sage-soft transition hover:text-bone"
                  >
                    + Add custom tool
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      promptFoundingUpgrade(
                        foundingUpgradeHint("Custom tools"),
                      )
                    }
                    className="rounded-full border border-sage/40 bg-sage/10 px-3 py-1.5 text-[12px] text-sage-soft transition hover:text-bone"
                  >
                    + Custom tool — Pro
                  </button>
                )}
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
                                service.name === "Grok" ||
                                service.name === "Cursor Pro" ||
                                service.name === "GitHub Copilot") &&
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
                  ? "Thank you — ToRay Pro is active. Unlimited tools & budget, Pro Vision, outlook, Stack Pulse, and CSV are unlocked."
                  : `Free: OpenAI/Anthropic Vision, ${FREE_TOOL_LIMIT} presets, budgets up to $${FREE_BUDGET_CAP}/mo. ${FOUNDING_PLAN_LABEL} unlocks custom tools and the full operating view.`}
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
                {!isFounding && (
                  <button
                    type="button"
                    onClick={() => openFeedback("founding_cta")}
                    className="flex w-full items-center justify-center rounded-full border border-hairline px-6 py-3 text-sm font-medium text-bone-muted transition hover:border-sage-soft/40 hover:text-bone"
                  >
                    Tell us what would make Pro worth it
                  </button>
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

        {/* Free: compact Pro teasers after tools so the list stays above the fold */}
        {!showStackPulse && (
          <section className="mt-6">
            <div className="flex flex-col gap-3 rounded-[24px] border border-hairline bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <div>
                <Eyebrow>Stack Pulse</Eyebrow>
                <p className="mt-1 text-sm text-bone-muted">
                  Daily burn, top tool share, and budget pace — with{" "}
                  {FOUNDING_PLAN_LABEL}.
                </p>
              </div>
              <a
                href={stripeHref}
                className="inline-flex shrink-0 items-center justify-center rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
              >
                Unlock — $12/mo
              </a>
            </div>
          </section>
        )}

        {trackedCount >= 2 && !isLoggedIn && (
          <div className="mt-6 rounded-[24px] border border-sage/30 bg-sage/10 px-5 py-4 md:px-6">
            <p className="font-serif text-lg text-bone">
              Nice — ${spent.toFixed(0)} across {trackedCount} tools on this
              device.
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
              Free stops at {FREE_TOOL_LIMIT} presets and ${FREE_BUDGET_CAP}{" "}
              budgets, and locks custom tools, outlook, Stack Pulse, CSV, and
              Pro Vision. {FOUNDING_PLAN_LABEL} at $12/mo unlocks the rest.
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
              <button
                type="button"
                onClick={() =>
                  openFeedback(
                    trackedCount >= FREE_TOOL_LIMIT
                      ? "tool_limit"
                      : "founding_cta",
                  )
                }
                className="rounded-full border border-hairline px-4 py-2 text-sm text-bone-muted transition hover:text-bone"
              >
                {trackedCount >= FREE_TOOL_LIMIT
                  ? "What’s blocking you?"
                  : "What would make Pro worth it?"}
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex h-16 max-w-6xl flex-col items-start justify-center gap-2 px-6 text-[12px] text-bone-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 ToRay</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Screenshots aren&apos;t stored. Totals stay local until you sign in.</span>
            <Link
              href="/blog"
              className="text-bone-muted transition hover:text-bone"
            >
              Blog
            </Link>
            <button
              type="button"
              onClick={() => openFeedback("footer")}
              className="inline-flex items-center gap-1 text-sage-soft transition hover:text-bone"
            >
              <MessageSquareText className="h-3 w-3" />
              Feedback
            </button>
          </div>
        </div>
      </footer>

      {isManualCorrectionOpen && (
        <ManualCorrectionModal
          mode={manualModalMode}
          amount={manualAmount}
          period={manualPeriod}
          service={manualService}
          serviceOptions={serviceOptions}
          customName={customName}
          isUsageBased={manualUsageBased}
          canUseCustomTools={allowCustomTools}
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
          onCustomNameChange={setCustomName}
          onUsageBasedChange={setManualUsageBased}
          onSwitchToAddCustom={() =>
            openManualCorrection("", undefined, null, { mode: "add_custom" })
          }
          onSwitchToTrack={() => openManualCorrection(manualService)}
          onClose={() => setIsManualCorrectionOpen(false)}
          onSave={saveManualCorrection}
          canClear={(() => {
            const target = (
              manualModalMode === "edit_custom"
                ? (editingCustomOriginal ?? customName.trim())
                : manualService
            )
              .trim()
              .toLowerCase();
            return Object.keys(serviceAmounts).some(
              (key) => key.toLowerCase() === target,
            );
          })()}
          onClear={() =>
            clearTrackedTool(
              manualModalMode === "edit_custom"
                ? (editingCustomOriginal ?? customName.trim())
                : manualService,
            )
          }
          canDeleteCustom={
            allowCustomTools &&
            manualModalMode === "edit_custom" &&
            Boolean(editingCustomOriginal)
          }
          onDeleteCustom={() =>
            deleteCustomTool(editingCustomOriginal ?? customName.trim())
          }
          onRequestCustomUpgrade={() =>
            promptFoundingUpgrade(foundingUpgradeHint("Custom tools"))
          }
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

      {feedbackContext && (
        <FeedbackModal
          context={feedbackContext}
          isLoggedIn={isLoggedIn}
          defaultEmail={userEmail}
          onClose={() => setFeedbackContext(null)}
        />
      )}
    </div>
  );
}
