"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Download,
  EyeOff,
  PencilLine,
  Plus,
  Radar,
  ScanLine,
  Shield,
  X,
} from "lucide-react";
import {
  applyHistoryToDashboard,
  fetchUserBillingScans,
  insertBillingScan,
  isValidServiceName,
  mergeBillingScanHistories,
  PRESET_SERVICES,
  type BillingScan,
  type ServiceName,
} from "@/lib/billing-scans";
import {
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
import { createClient } from "@/lib/supabase/client";

const INITIAL_SPENT = 0;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const SCAN_HISTORY_KEY = "toray-billing-scans";
const STRIPE_URL =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ??
  "https://buy.stripe.com/6oU14m0Lu92V2dL0dx9sk00";

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
    icon: Radar,
    text: "Cloud backup of spend, budget, and custom tools across devices",
  },
  {
    icon: Shield,
    text: "Founding price locked at $12/mo for as long as you stay",
  },
  {
    icon: ScanLine,
    text: "Funds multi-provider Vision (Gemini, Grok receipts) next",
  },
];

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
              Scanning works here too. Sign in when you want the same totals on
              your computer — still free on-device.
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
            <Eyebrow>Free account</Eyebrow>
            <h2
              id="sign-in-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              Sign in with email
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              We&apos;ll send a magic link. Scanning stays free — sign in only
              if you want cloud sync across devices.
            </p>
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
                min="0"
                step="0.01"
                required
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

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
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
        {error && <p className="mt-3 text-sm text-warning">{error}</p>}
      </form>
    </div>
  );
}

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

  const visibleTools = catalog.filter(
    (tool) =>
      serviceAmounts[tool.name] !== undefined ||
      !hiddenTools.includes(tool.name),
  );

  const animatedSpent = useAnimatedNumber(spent);
  const projected = computeProjectedSpend(serviceAmounts, catalog);
  const budgetBasis = budget && budget > 0 ? budget : null;
  const meterRatio = budgetBasis
    ? Math.min((projected / budgetBasis) * 100, 100)
    : 0;
  const remaining =
    budgetBasis != null ? Math.max(budgetBasis - projected, 0) : null;
  const overspend =
    budgetBasis != null
      ? Math.round((projected - budgetBasis) * 100) / 100
      : 0;
  const isOverBudget = budgetBasis != null && projected > budgetBasis;
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
      setBudget(merged.budget);
      writeBudget(merged.budget);
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
    const local = readLocalPrefs();
    setBudget(local.budget);
    setHiddenTools(local.hiddenTools);
    setCustomTools(local.customTools);
    setIsFounding(local.isFounding);

    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "1" || params.get("founding") === "1") {
      setIsFounding(true);
      writeFounding(true);
      params.delete("upgraded");
      params.delete("founding");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }

    const supabase = createClient();
    supabaseRef.current = supabase;

    async function hydrateDashboard() {
      let localHistory: BillingScan[] = [];
      const stored = window.localStorage.getItem(SCAN_HISTORY_KEY);

      if (stored) {
        try {
          localHistory = JSON.parse(stored) as BillingScan[];
        } catch {
          window.localStorage.removeItem(SCAN_HISTORY_KEY);
        }
      }

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

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) return;

      setUserEmail(user.email);
      setIsLoggedIn(true);

      const remotePrefs = mergePrefs(
        local,
        user.user_metadata as {
          toray_budget?: number | null;
          toray_hidden_tools?: string[];
          toray_custom_tools?: CustomToolPref[];
          toray_founding?: boolean;
        },
      );
      setBudget(remotePrefs.budget);
      setHiddenTools(remotePrefs.hiddenTools);
      setCustomTools(remotePrefs.customTools);
      setIsFounding(remotePrefs.isFounding);
      writeBudget(remotePrefs.budget);
      writeHiddenTools(remotePrefs.hiddenTools);
      writeCustomTools(remotePrefs.customTools);
      writeFounding(remotePrefs.isFounding);

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
    }

    void hydrateDashboard();
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
      const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || window.location.origin}/auth/callback`;

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

  function markUpdated(at = new Date()) {
    setLastSyncedAt(formatClock(at));
  }

  function commitBudgetDraft() {
    const parsed = Number.parseFloat(budgetDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      persistPrefs({ budget: null });
      setIsEditingBudget(false);
      return;
    }
    persistPrefs({ budget: Math.round(parsed * 100) / 100 });
    setIsEditingBudget(false);
  }

  function saveBillingScan(scan: BillingScan) {
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

    const supabase = supabaseRef.current;
    if (supabase && isLoggedIn) {
      void insertBillingScan(supabase, scan).catch(() => {});
    }
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
    const tool = findTool(service);
    const suggested = tool?.suggestedAmount ?? 0;
    const currentAmount = amount ?? serviceAmounts[service] ?? suggested;

    setIsCustomMode(Boolean(options?.custom));
    setCustomName(options?.custom ? "" : service);
    setManualService(service);
    setManualUsageBased(tool?.isUsageBased ?? true);
    setManualAmount(
      currentAmount > 0 || amount !== undefined
        ? currentAmount.toFixed(2)
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

    saveBillingScan({
      id: crypto.randomUUID(),
      service: resolvedName,
      amountUsd: Math.round(amount * 100) / 100,
      billingPeriod:
        manualPeriod.trim() ||
        (manualUsageBased ? null : "Monthly subscription"),
      confidence: "high",
      scannedAt: new Date().toISOString(),
    });
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
        service?: "OpenAI" | "Anthropic" | "Other" | null;
        amountUsd?: number;
        billingPeriod?: string | null;
        confidence?: "high" | "medium" | "low";
        error?: string;
      };

      if (
        !response.ok ||
        typeof result.amountUsd !== "number" ||
        result.confidence === "low" ||
        (result.service !== "OpenAI" && result.service !== "Anthropic")
      ) {
        throw new Error(
          result.error ??
            "This does not look like a clear OpenAI Platform or Anthropic Console billing screen. Use Add tool to enter any other provider manually.",
        );
      }

      setScanStep(2);
      const amountUsd = result.amountUsd;
      const serviceName: ServiceName =
        result.service === "OpenAI" ? "OpenAI API" : "Anthropic API";
      const scan: BillingScan = {
        id: crypto.randomUUID(),
        service: serviceName,
        amountUsd,
        billingPeriod: result.billingPeriod ?? null,
        confidence: result.confidence ?? "medium",
        scannedAt: new Date().toISOString(),
      };

      saveBillingScan(scan);
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
      openManualCorrection("Gemini API", undefined, null, { custom: false });
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
    downloadSpendCsv({
      amounts: serviceAmounts,
      history: scanHistory,
      budget,
      projected,
    });
  }

  const stripeHref = `${STRIPE_URL}${STRIPE_URL.includes("?") ? "&" : "?"}client_reference_id=toray_founding`;

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

          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-sm text-bone-muted sm:inline-flex">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
              </span>
              Free to scan
            </span>
            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <span className="hidden max-w-[160px] truncate text-sm text-bone-muted sm:block">
                  {userEmail}
                </span>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:text-bone"
                  >
                    Sign out
                  </button>
                </form>
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
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:border-sage-soft/40 hover:text-bone"
              >
                Upgrade
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <section className="grid grid-cols-1 items-start gap-8 py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
          <div>
            <Eyebrow>Free Instant Scanner</Eyebrow>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
              Know your AI burn before your card does.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-bone-muted">
              Scan OpenAI or Anthropic screenshots, then track Gemini, Grok,
              Runway, Cursor, or any custom tool by hand. Free on this device —
              sign in when you want a backup.
            </p>
            <p className="mt-3 text-[13px] text-bone-muted">
              Screenshots are analyzed securely and not stored by ToRay. Totals
              stay on this device until you sign in.
            </p>
            <p className="mt-6 text-sm text-bone-muted">
              {lastSyncedAt
                ? `Last update ${lastSyncedAt}`
                : hasSpend
                  ? "Totals loaded from this device."
                  : "Your dashboard starts empty."}
            </p>
          </div>

          <div id="quick-scan" className="rounded-[28px] border border-sage/35 bg-surface p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Scan now</Eyebrow>
              <span className="text-[12px] text-mint">
                {scanHistory.length === 0
                  ? isLoggedIn
                    ? "No updates yet · cloud ready"
                    : "No updates yet · this device"
                  : `${scanHistory.length} update${scanHistory.length === 1 ? "" : "s"}${isLoggedIn ? " · synced" : " · this device"}`}
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
                    OpenAI Platform or Anthropic Console for instant Vision. Any other provider — add it as a tool below.
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
                {budget != null && !isEditingBudget && (
                  <button
                    type="button"
                    onClick={() => {
                      setBudgetDraft(String(Math.round(budget)));
                      setIsEditingBudget(true);
                    }}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium text-sage-soft transition hover:text-bone"
                  >
                    Edit budget
                  </button>
                )}
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${!hasSpend ? "bg-bone/10 text-bone-muted" : isOverBudget ? "bg-danger/20 text-danger" : "bg-sage/25 text-mint"}`}>
                  {!hasSpend ? "Empty" : isOverBudget ? "Over budget" : budget != null ? "On track" : "Tracked"}
                </span>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-baseline gap-2">
              <span className={`font-serif text-4xl tracking-[-0.02em] tabular-nums transition-colors duration-500 ${scanStatus === "success" ? "text-mint" : "text-bone"}`}>
                ${animatedSpent.toFixed(2)}
              </span>
              {budget != null && !isEditingBudget ? (
                <span className="text-sm tabular-nums text-bone-muted">
                  spent · ${budget.toFixed(0)} budget
                </span>
              ) : null}
            </div>
            <div className="mt-6">
              {budget != null && !isEditingBudget ? (
                <>
                  <Meter ratio={meterRatio} />
                  <div className="mt-2.5 flex justify-between text-xs text-bone-muted">
                    <span>{meterRatio.toFixed(0)}% of budget (outlook)</span>
                    <span>
                      {remaining != null
                        ? `$${remaining.toFixed(0)} headroom`
                        : null}
                    </span>
                  </div>
                </>
              ) : isEditingBudget ? (
                <form
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
                      min="1"
                      step="1"
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
              )}
              <p className={`mt-3 text-[13px] ${isOverBudget ? "text-danger" : "text-bone-muted"}`}>
                {!hasSpend
                  ? "Scan or add a tool to see month-end outlook."
                  : isOverBudget
                    ? `Outlook $${projected.toFixed(0)} by ${monthEnd} — $${overspend.toFixed(0)} over. Edit budget or hide tools you don’t use.`
                    : `Outlook $${projected.toFixed(0)} by ${monthEnd}`}
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Tools tracked</Eyebrow>
              <span className="rounded-full bg-sage/20 px-2.5 py-1 text-[11px] font-medium text-mint">
                {trackedCount} set
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">{trackedCount}</span>
              <span className="text-sm text-bone-muted">visible {visibleTools.length}</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              {trackedCount === 0
                ? "Add Gemini, Grok, or any tool — your list, not ours."
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
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">
                ${hasSpend ? projected.toFixed(0) : "0"}
              </span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              {!hasSpend
                ? "Fixed plans stay flat. Usage-based spend is paced to month-end."
                : `$${fixedTracked.toFixed(0)} fixed + usage paced from $${usageTracked.toFixed(0)} so far.`}
            </p>
          </div>
        </section>

        {trackedCount >= 2 && !isLoggedIn && (
          <div className="mt-6 rounded-[24px] border border-sage/30 bg-sage/10 px-5 py-4 md:px-6">
            <p className="font-serif text-lg text-bone">
              Nice — ${spent.toFixed(0)} across {trackedCount} tools on this device.
            </p>
            <p className="mt-1 text-sm text-bone-muted">
              Free magic-link sign-in backs up spend, budget, and custom tools so a browser clear doesn’t wipe them.
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
                  onClick={() => openManualCorrection("Gemini API", undefined, null, { custom: false })}
                  className="inline-flex items-center gap-1 text-sm text-sage-soft transition hover:text-bone"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add tool
                </button>
              </div>
            </div>
            <p className="mt-2 text-[12px] text-bone-muted">
              Tap a card to edit. Suggested prices are prefill only. Add a custom name anytime.
            </p>

            <ul className="mt-5 space-y-3">
              {visibleTools.map((service) => {
                const savedAmount = serviceAmounts[service.name];
                const isSet = savedAmount !== undefined;
                return (
                  <li key={service.name} className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        openManualCorrection(
                          service.name,
                          savedAmount,
                          service.isUsageBased ? null : "Monthly subscription",
                        )
                      }
                      className="flex w-full items-center gap-4 rounded-2xl bg-surface-raised/70 px-4 py-4 text-left transition duration-180 hover:bg-surface-raised hover:ring-1 hover:ring-sage-soft/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage/40"
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
                            service.name === "Anthropic API")
                            ? "Scan or edit"
                            : "Set amount"}
                        </p>
                      </div>
                    </button>
                    {!isSet && (
                      <button
                        type="button"
                        onClick={() => hideTool(service.name)}
                        className="absolute right-3 top-3 rounded-full p-1.5 text-bone-muted/70 transition hover:bg-bone/10 hover:text-bone"
                        aria-label={`Hide ${service.name}`}
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[28px] border border-hairline bg-surface p-6">
              <Eyebrow>Your data</Eyebrow>
              <p className="mt-3 text-sm leading-relaxed text-bone-muted">
                Export a CSV of tools, outlook, and update history anytime — free.
              </p>
              <button
                type="button"
                onClick={exportCsv}
                disabled={!hasSpend}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-hairline px-4 py-2.5 text-sm font-medium text-bone transition hover:border-sage-soft/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
            </div>

            <div
              id="founding-member"
              className="rounded-[28px] border border-sage/40 bg-gradient-to-b from-sage/20 to-surface p-6 md:p-8"
            >
              <div className="flex items-center justify-between">
                <Eyebrow>
                  {isFounding ? "Founding Member" : "When you’re ready"}
                </Eyebrow>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">
                  {isFounding ? "Active" : "$12/mo"}
                </span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-bone-muted">
                {isFounding
                  ? "Thank you — your founding price stays locked. Keep tracking freely; sync and export are yours."
                  : "Everything above stays free. Founding Member is for people who already rely on ToRay and want cloud backup plus a locked $12 price that funds the next Vision providers."}
              </p>
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
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center rounded-full bg-sage px-6 py-3 text-sm font-semibold text-bone transition hover:bg-sage-glow"
                  >
                    Become a Founding Member — $12/mo
                  </a>
                )}
                <p className="text-center text-[11px] text-bone-muted">
                  {isFounding
                    ? "You’re supporting multi-provider Vision next."
                    : "Secure checkout via Stripe · cancel anytime"}
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
                {!isFounding && (
                  <button
                    type="button"
                    onClick={() => persistPrefs({ isFounding: true })}
                    className="w-full text-center text-[11px] text-bone-muted underline-offset-2 hover:text-bone hover:underline"
                  >
                    Already checked out? Mark Founding Member here
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
