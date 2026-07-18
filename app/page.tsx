"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BellRing,
  Check,
  PencilLine,
  Plus,
  RefreshCw,
  Radar,
  ScanLine,
  X,
} from "lucide-react";
import {
  applyHistoryToDashboard,
  fetchUserBillingScans,
  insertBillingScan,
  mergeBillingScanHistories,
  SUPPORTED_SERVICES,
  type BillingScan,
  type SupportedService,
} from "@/lib/billing-scans";
import { createClient } from "@/lib/supabase/client";

const BUDGET = 200;
const INITIAL_SPENT = 0;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const PACE = 1.32;
const SCAN_HISTORY_KEY = "toray-billing-scans";
const STRIPE_URL =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ??
  "https://buy.stripe.com/6oU14m0Lu92V2dL0dx9sk00";

type ScanStatus = "idle" | "scanning" | "success" | "error";

type Service = {
  name: SupportedService;
  type: string;
  /** Prefill only — never shown as the user's spend until they save. */
  suggestedAmount: number;
  isUsageBased: boolean;
  accent: string;
};

const services: Service[] = [
  {
    name: "OpenAI API",
    type: "Usage-based",
    suggestedAmount: 50,
    isUsageBased: true,
    accent: "bg-clay/20 text-clay",
  },
  {
    name: "Anthropic API",
    type: "Usage-based",
    suggestedAmount: 40,
    isUsageBased: true,
    accent: "bg-blush/20 text-blush",
  },
  {
    name: "ChatGPT Plus",
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-mint/20 text-mint",
  },
  {
    name: "Claude Pro",
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-blush/20 text-blush",
  },
  {
    name: "Cursor Pro",
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-sage/25 text-sage-soft",
  },
  {
    name: "Midjourney",
    type: "Subscription",
    suggestedAmount: 30,
    isUsageBased: false,
    accent: "bg-moss/25 text-sage-soft",
  },
  {
    name: "GitHub Copilot",
    type: "Subscription",
    suggestedAmount: 10,
    isUsageBased: false,
    accent: "bg-bone/10 text-bone-muted",
  },
  {
    name: "Perplexity Pro",
    type: "Subscription",
    suggestedAmount: 20,
    isUsageBased: false,
    accent: "bg-clay/15 text-clay",
  },
];

const SERVICE_DEFAULTS = services.map((service) => ({
  name: service.name,
  amount: 0,
}));

function endOfMonthLabel(date = new Date()) {
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StripeCheckoutLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={STRIPE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

const SCAN_STEPS = [
  "Uploading securely…",
  "Reading your billing screen…",
  "Extracting your USD total…",
];

const PRO_FEATURES = [
  { icon: ScanLine, text: "Unlimited OpenAI & Anthropic screenshot scans" },
  { icon: Radar, text: "Cloud sync so your totals follow you across devices" },
  { icon: BellRing, text: "Founding Member price locked at $12/mo" },
  { icon: RefreshCw, text: "Priority access to new providers as we add them" },
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
  message = "You're in. Check your inbox for your free account link.",
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
  submitLabel = "Get free account",
  submittingLabel = "Saving…",
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
      className="relative z-10 border-b border-clay/25 bg-gradient-to-br from-clay/20 via-surface to-sage/15 md:hidden"
    >
      <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="rounded-[24px] border border-clay/30 bg-surface-raised/90 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.28)] sm:p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold tracking-wide text-clay sm:text-sm">
                📱 On your mobile phone?
              </p>
              <h2
                id="mobile-bridge-heading"
                className="mt-1.5 font-serif text-[1.35rem] leading-snug tracking-[-0.02em] text-bone sm:text-2xl"
              >
                No OpenAI/Anthropic screenshot on your device right now?
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-bone-muted sm:text-[15px]">
                Email yourself a free account link for desktop. Scanning stays
                free — Founding Member ($12/mo) adds cloud sync across devices.
              </p>
            </div>

            <div className="w-full shrink-0 md:max-w-md">
              <WaitlistForm
                id="mobile-spot-waitlist"
                email={email}
                onEmailChange={onEmailChange}
                submitted={submitted}
                isSubmitting={isSubmitting}
                onSubmit={onSubmit}
                variant="mobile"
                submitLabel="Secure My Spot"
                submittingLabel="Sending link…"
                successMessage="Check your email for a magic link to your free account."
              />
              {error && (
                <p className="mt-2 text-center text-sm text-warning md:text-left">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
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
  onAmountChange,
  onPeriodChange,
  onServiceChange,
  onClose,
  onSave,
  error,
}: {
  amount: string;
  period: string;
  service: SupportedService;
  onAmountChange: (value: string) => void;
  onPeriodChange: (value: string) => void;
  onServiceChange: (value: SupportedService) => void;
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
            <Eyebrow>Manual correction</Eyebrow>
            <h2
              id="manual-correction-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              Set the amount yourself
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              Set a subscription total or correct a scan. Suggested plan prices
              are only a starting point.
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
          <label className="grid gap-1.5 text-sm text-bone-muted">
            Service
            <select
              value={service}
              onChange={(event) =>
                onServiceChange(event.target.value as SupportedService)
              }
              className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
            >
              {SUPPORTED_SERVICES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 text-sm text-bone-muted">
            Current-period total (USD)
            <div className="flex rounded-xl border border-hairline bg-background transition focus-within:border-sage-soft/60 focus-within:ring-2 focus-within:ring-sage/20">
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
  const [serviceAmounts, setServiceAmounts] = useState<
    Partial<Record<SupportedService, number>>
  >({});
  const [scanHistory, setScanHistory] = useState<BillingScan[]>([]);

  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);
  const [isWaitlistSubmitting, setIsWaitlistSubmitting] = useState(false);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isManualCorrectionOpen, setIsManualCorrectionOpen] = useState(false);
  const [manualService, setManualService] =
    useState<SupportedService>("OpenAI API");
  const [manualAmount, setManualAmount] = useState("");
  const [manualPeriod, setManualPeriod] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const animatedSpent = useAnimatedNumber(spent);
  const spentRatio = Math.min((animatedSpent / BUDGET) * 100, 100);
  const remaining = Math.max(BUDGET - animatedSpent, 0);
  const projected = Math.round(animatedSpent * PACE * 100) / 100;
  const overspend = Math.round((projected - BUDGET) * 100) / 100;
  const isOverPace = spent > 0 && overspend > 0;
  const isScanning = scanStatus === "scanning";
  const trackedCount = Object.keys(serviceAmounts).length;
  const monthEnd = endOfMonthLabel();
  const hasSpend = spent > 0 || trackedCount > 0;

  useEffect(() => {
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

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user?.email) {
        setUserEmail(user.email);
        setIsLoggedIn(true);

        const remoteHistory = await fetchUserBillingScans(supabase);
        const merged = mergeBillingScanHistories(localHistory, remoteHistory);
        const dashboard = applyHistoryToDashboard(
          merged,
          INITIAL_SPENT,
          SERVICE_DEFAULTS,
        );

        setScanHistory(dashboard.scanHistory);
        setServiceAmounts(dashboard.serviceAmounts);
        setSpent(dashboard.spent);
        window.localStorage.setItem(
          SCAN_HISTORY_KEY,
          JSON.stringify(dashboard.scanHistory),
        );
        return;
      }

      if (localHistory.length === 0) return;

      const dashboard = applyHistoryToDashboard(
        localHistory,
        INITIAL_SPENT,
        SERVICE_DEFAULTS,
      );
      setScanHistory(dashboard.scanHistory);
      setServiceAmounts(dashboard.serviceAmounts);
      setSpent(dashboard.spent);
    }

    void hydrateDashboard();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
      setWaitlistError("Sign-up is temporarily unavailable. Please try again later.");
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

  function scrollToFounding() {
    document.getElementById("founding-member")?.scrollIntoView({ behavior: "smooth" });
  }

  function scrollToScanner() {
    document.getElementById("quick-scan")?.scrollIntoView({ behavior: "smooth" });
  }

  function markUpdated() {
    setLastSyncedAt(
      new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
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

  function openManualCorrection(
    service: SupportedService = "OpenAI API",
    amount?: number,
    period?: string | null,
  ) {
    const suggested =
      services.find((item) => item.name === service)?.suggestedAmount ?? 0;
    const currentAmount = amount ?? serviceAmounts[service] ?? suggested;

    setManualService(service);
    setManualAmount(currentAmount.toFixed(2));
    setManualPeriod(period ?? "");
    setManualError(null);
    setIsManualCorrectionOpen(true);
  }

  function saveManualCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number.parseFloat(manualAmount);

    if (!Number.isFinite(amount) || amount < 0) {
      setManualError("Enter a valid USD amount of zero or more.");
      return;
    }

    saveBillingScan({
      id: crypto.randomUUID(),
      service: manualService,
      amountUsd: Math.round(amount * 100) / 100,
      billingPeriod: manualPeriod.trim() || null,
      confidence: "high",
      scannedAt: new Date().toISOString(),
    });
    setScanStatus("success");
    setScanMessage(
      `${manualService} · $${amount.toFixed(2)} saved to your dashboard`,
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
            "This does not look like a clear OpenAI Platform or Anthropic Console billing screen.",
        );
      }

      setScanStep(2);
      const amountUsd = result.amountUsd;
      const serviceName: SupportedService =
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
      // Keep the user unblocked when classification is uncertain.
      openManualCorrection();
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
                onClick={scrollToFounding}
                className="rounded-full border border-hairline px-3 py-2 text-sm text-bone-muted transition hover:text-bone"
              >
                Sign in
              </button>
            )}
            <StripeCheckoutLink className="rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow">
              $12/mo
            </StripeCheckoutLink>
          </div>
        </div>
      </header>

      <MobileDesktopBridgeBanner
        email={waitlistEmail}
        onEmailChange={setWaitlistEmail}
        submitted={waitlistSubmitted}
        isSubmitting={isWaitlistSubmitting}
        onSubmit={handleWaitlistSubmit}
        error={waitlistError}
      />

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <section className="grid grid-cols-1 items-start gap-8 py-8 lg:grid-cols-2 lg:gap-10 lg:py-10">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-mint">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                Live
              </span>
              <Eyebrow>Free Instant Scanner</Eyebrow>
            </div>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
              Know your AI burn before your card does.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-bone-muted">
              Drop an OpenAI or Anthropic billing screenshot to read this
              month&apos;s total. Add ChatGPT, Cursor, Midjourney, and more by
              hand. Free to use — sign in to sync across devices.
            </p>
            <p className="mt-3 text-[13px] text-bone-muted">
              Screenshots are analyzed securely and not stored by ToRay. Totals
              stay on this device until you sign in.
            </p>
            <p className="mt-6 text-sm text-bone-muted">
              {lastSyncedAt ? `Last update ${lastSyncedAt}` : "Your dashboard starts empty."}
            </p>
          </div>

          <div id="quick-scan" className="rounded-[28px] border border-sage/35 bg-surface p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)] md:p-6">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Scan now</Eyebrow>
              <span className="text-[12px] text-mint">
                {scanHistory.length} saved{isLoggedIn ? " · cloud" : " · this device"}
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
                    OpenAI Platform or Anthropic Console. Instant Vision read — image not kept.
                  </p>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-5 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition hover:bg-sage-glow">
                    Choose file
                  </button>
                  <button
                    type="button"
                    onClick={() => openManualCorrection()}
                    className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    Enter an amount manually
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
                      latestScan?.service,
                      latestScan?.amountUsd,
                      latestScan?.billingPeriod,
                    );
                  }}
                  className="inline-flex items-center gap-1 text-[13px] text-sage-soft underline-offset-4 transition hover:text-bone hover:underline"
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  {scanStatus === "success" ? "Correct amount" : "Enter manually"}
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Spend / Budget</Eyebrow>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${!hasSpend ? "bg-bone/10 text-bone-muted" : isOverPace ? "bg-danger/20 text-danger" : "bg-sage/25 text-mint"}`}>
                {!hasSpend ? "Empty" : isOverPace ? "Over pace" : "On track"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className={`font-serif text-4xl tracking-[-0.02em] tabular-nums transition-colors duration-500 ${scanStatus === "success" ? "text-mint" : "text-bone"}`}>
                ${animatedSpent.toFixed(2)}
              </span>
              <span className="text-sm tabular-nums text-bone-muted">/ ${BUDGET}</span>
            </div>
            <div className="mt-6">
              <Meter ratio={spentRatio} />
              <div className="mt-2.5 flex justify-between text-xs text-bone-muted">
                <span>{spentRatio.toFixed(0)}% used</span>
                <span>${remaining.toFixed(2)} left</span>
              </div>
              <p className={`mt-3 text-[13px] ${isOverPace ? "text-danger" : "text-bone-muted"}`}>
                {!hasSpend
                  ? "Scan or set a tool to project month-end spend."
                  : isOverPace
                    ? `Projected $${projected.toFixed(0)} by ${monthEnd} — $${overspend.toFixed(0)} over budget`
                    : `Projected $${projected.toFixed(0)} by ${monthEnd}`}
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
              <span className="text-sm text-bone-muted">/ {services.length}</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              {trackedCount === 0
                ? "Nothing tracked yet. Scan OpenAI/Anthropic or tap a card below."
                : "Amounts you save update your total and projection instantly."}
            </p>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Founding plan</Eyebrow>
              <span className="rounded-full bg-clay/20 px-2.5 py-1 text-[11px] font-medium text-clay">$12/mo</span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">$12</span>
              <span className="text-sm text-bone-muted">cloud sync</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              Free covers scanning on this device. Upgrade for sync across devices and the locked founding price.
            </p>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8 lg:col-span-3">
            <div className="flex items-center justify-between">
              <Eyebrow>Your AI tools</Eyebrow>
              <button
                type="button"
                onClick={() => openManualCorrection("ChatGPT Plus")}
                className="inline-flex items-center gap-1 text-sm text-sage-soft transition hover:text-bone"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
            <p className="mt-2 text-[12px] text-bone-muted">
              Tap a card to set its amount. Suggested prices are only prefill — nothing counts until you save.
            </p>

            <ul className="mt-5 space-y-3">
              {services.map((service) => {
                const savedAmount = serviceAmounts[service.name];
                const isSet = savedAmount !== undefined;
                return (
                  <li key={service.name}>
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
                        </div>
                        <p className="mt-1 text-[13px] text-bone-muted">
                          {service.type}
                          {isSet
                            ? service.isUsageBased
                              ? " · This period"
                              : " · Monthly"
                            : ` · Suggested $${service.suggestedAmount.toFixed(0)}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-medium tabular-nums text-bone">
                          {isSet ? `$${savedAmount.toFixed(2)}` : "—"}
                        </p>
                        <p className="inline-flex items-center gap-1 text-[11px] text-sage-soft">
                          <PencilLine className="h-3 w-3" />
                          {service.isUsageBased ? "Scan or edit" : "Set amount"}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div
              id="founding-member"
              className="rounded-[28px] border border-sage/40 bg-gradient-to-b from-sage/20 to-surface p-6 md:p-8"
            >
              <div className="flex items-center justify-between">
                <Eyebrow>Founding Member</Eyebrow>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">
                  $12/mo
                </span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-bone-muted">
                Free: scan + manual tools on this device. Paid: cloud sync and the locked founding price.
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
                <StripeCheckoutLink className="flex w-full items-center justify-center rounded-full bg-sage px-6 py-3 text-sm font-semibold text-bone transition hover:bg-sage-glow">
                  Upgrade — $12/mo
                </StripeCheckoutLink>
                <p className="text-center text-[11px] text-bone-muted">
                  Secure checkout via Stripe
                </p>
                {!isLoggedIn && (
                  <>
                    <div className="relative py-1 text-center text-[11px] uppercase tracking-wider text-bone-muted/70">
                      <span className="relative z-10 bg-[var(--surface)] px-2">or free magic-link sign-in</span>
                      <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
                    </div>
                    <WaitlistForm
                      email={waitlistEmail}
                      onEmailChange={setWaitlistEmail}
                      submitted={waitlistSubmitted}
                      isSubmitting={isWaitlistSubmitting}
                      onSubmit={handleWaitlistSubmit}
                      variant="default"
                      submitLabel="Email me a sign-in link"
                      submittingLabel="Sending link…"
                      successMessage="Check your email for a magic link to sign in."
                    />
                    {waitlistError && (
                      <p className="mt-2 text-center text-sm text-warning">{waitlistError}</p>
                    )}
                  </>
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
          onAmountChange={setManualAmount}
          onPeriodChange={setManualPeriod}
          onServiceChange={setManualService}
          onClose={() => setIsManualCorrectionOpen(false)}
          onSave={saveManualCorrection}
          error={manualError}
        />
      )}
    </div>
  );
}
