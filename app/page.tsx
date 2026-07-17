"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BellRing,
  Check,
  Plus,
  RefreshCw,
  Radar,
  ScanLine,
  Star,
} from "lucide-react";

const BUDGET = 200;
const INITIAL_SPENT = 142.5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const PACE = 1.32;
const IDLE_WASTE = 10.0;
const SCAN_HISTORY_KEY = "toray-billing-scans";

type ServiceStatus = "active" | "warning" | "paused";
type ScanStatus = "idle" | "scanning" | "success" | "error";
type SupportedService = "OpenAI API" | "Anthropic API";

type BillingScan = {
  id: string;
  service: SupportedService;
  amountUsd: number;
  billingPeriod: string | null;
  confidence: "high" | "medium" | "low";
  scannedAt: string;
};

type Service = {
  name: string;
  type: string;
  amount: number;
  isUsageBased: boolean;
  renewal: string;
  status: ServiceStatus;
  accent: string;
};

const services: Service[] = [
  {
    name: "OpenAI API",
    type: "Usage-based",
    amount: 68.2,
    isUsageBased: true,
    renewal: "Resets Aug 1",
    status: "warning",
    accent: "bg-clay/20 text-clay",
  },
  {
    name: "Anthropic API",
    type: "Usage-based",
    amount: 24.3,
    isUsageBased: true,
    renewal: "Resets Aug 1",
    status: "active",
    accent: "bg-blush/20 text-blush",
  },
  {
    name: "ChatGPT Plus",
    type: "Subscription",
    amount: 20.0,
    isUsageBased: false,
    renewal: "Renews Jul 17",
    status: "active",
    accent: "bg-mint/20 text-mint",
  },
  {
    name: "Midjourney",
    type: "Subscription",
    amount: 30.0,
    isUsageBased: false,
    renewal: "Renews Jul 22",
    status: "active",
    accent: "bg-moss/25 text-sage-soft",
  },
  {
    name: "GitHub Copilot",
    type: "Subscription",
    amount: 10.0,
    isUsageBased: false,
    renewal: "Renews Jul 28",
    status: "paused",
    accent: "bg-bone/10 text-bone-muted",
  },
];

const statusConfig: Record<ServiceStatus, { label: string; chip: string }> = {
  active: { label: "Active", chip: "bg-mint/15 text-mint" },
  warning: { label: "Over pace", chip: "bg-clay/20 text-clay" },
  paused: { label: "Idle 23 days", chip: "bg-bone/5 text-bone-muted" },
};

const SCAN_STEPS = [
  "Uploading securely…",
  "Reading your billing screen…",
  "Extracting your USD total…",
];

const PRO_FEATURES = [
  { icon: RefreshCw, text: "Daily auto-sync from OpenAI, Anthropic + 12 more" },
  { icon: BellRing, text: "Overspend alerts before your card finds out" },
  { icon: Radar, text: "Idle-spend finder — members save $38/mo on average" },
  { icon: ScanLine, text: "Unlimited screenshot scans" },
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

function WaitlistSuccess({ compact = false }: { compact?: boolean }) {
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
        We will notify you as soon as we officially launch.
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
}: {
  email: string;
  onEmailChange: (value: string) => void;
  submitted: boolean;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  variant?: "default" | "compact" | "indigo";
  id?: string;
}) {
  if (submitted) {
    return <WaitlistSuccess compact={variant === "compact"} />;
  }

  const inputClass =
    variant === "indigo"
      ? "w-full rounded-full border border-indigo-500/30 bg-slate-900/60 px-4 py-3 text-sm text-bone placeholder:text-bone-muted/60 outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/20"
      : "w-full rounded-full border border-hairline bg-background/60 px-4 py-3 text-sm text-bone placeholder:text-bone-muted/60 outline-none transition focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20";

  const buttonClass =
    variant === "indigo"
      ? "shrink-0 rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition duration-180 hover:bg-indigo-500"
      : variant === "compact"
        ? "shrink-0 rounded-full bg-sage px-4 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow"
        : "shrink-0 rounded-full bg-sage px-6 py-3 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow";

  const layoutClass =
    variant === "compact"
      ? "flex flex-col gap-2 sm:flex-row sm:items-center"
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
        className={inputClass}
      />
      <button type="submit" disabled={isSubmitting} className={`${buttonClass} disabled:cursor-wait disabled:opacity-60`}>
        {isSubmitting ? "Joining…" : "Join the Waitlist"}
      </button>
    </form>
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

function ValidationPhaseBanner({
  email,
  onEmailChange,
  submitted,
  isSubmitting,
  onSubmit,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  submitted: boolean;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}) {
  return (
    <section
      id="waitlist"
      aria-labelledby="validation-phase-heading"
      className="mb-8 rounded-[28px] border border-indigo-500/25 bg-gradient-to-br from-slate-900/90 via-indigo-950/50 to-surface p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-8"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/15 text-lg">
              📢
            </span>
            <h2
              id="validation-phase-heading"
              className="font-serif text-xl tracking-[-0.02em] text-bone md:text-2xl"
            >
              Public Validation Phase
            </h2>
          </div>

          <p className="mt-4 text-[15px] leading-relaxed text-bone/90">
            ToRay is currently an interactive UI concept. We only build features
            that engineers actually want to use.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-bone-muted">
            If you want us to fully build and launch this smart screenshot
            scanner, join the free waitlist below. Your signup acts as a
            &ldquo;vote&rdquo; to prioritize this product.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-bone-muted">
            Early waitlist members will lock in our $12/month Founding Member
            price forever upon official launch.
          </p>
        </div>

        <div className="w-full shrink-0 lg:max-w-sm">
          <span className="mb-3 block rounded-full bg-indigo-500/15 px-3 py-1 text-center text-[11px] font-medium uppercase tracking-wider text-indigo-200/90">
            Free pre-order · No payment required
          </span>
          <WaitlistForm
            email={email}
            onEmailChange={onEmailChange}
            submitted={submitted}
            isSubmitting={isSubmitting}
            onSubmit={onSubmit}
            variant="indigo"
          />
        </div>
      </div>
    </section>
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

export default function Dashboard() {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const animatedSpent = useAnimatedNumber(spent);
  const spentRatio = Math.min((animatedSpent / BUDGET) * 100, 100);
  const remaining = Math.max(BUDGET - animatedSpent, 0);
  const projected = Math.round(animatedSpent * PACE * 100) / 100;
  const overspend = Math.round((projected - BUDGET) * 100) / 100;
  const isOverPace = overspend > 0;
  const isScanning = scanStatus === "scanning";

  useEffect(() => {
    const stored = window.localStorage.getItem(SCAN_HISTORY_KEY);
    if (!stored) return;

    try {
      const history = JSON.parse(stored) as BillingScan[];
      const latestAmounts = history.reduce<
        Partial<Record<SupportedService, number>>
      >((amounts, scan) => {
        if (scan.service && Number.isFinite(scan.amountUsd)) {
          amounts[scan.service] = scan.amountUsd;
        }
        return amounts;
      }, {});

      const updatedSpend = (Object.entries(latestAmounts) as [
        SupportedService,
        number,
      ][]).reduce((total, [serviceName, amount]) => {
        const defaultAmount =
          services.find((service) => service.name === serviceName)?.amount ?? 0;
        return total - defaultAmount + amount;
      }, INITIAL_SPENT);

      setScanHistory(history);
      setServiceAmounts(latestAmounts);
      setSpent(updatedSpend);
    } catch {
      window.localStorage.removeItem(SCAN_HISTORY_KEY);
    }
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

    const endpoint = process.env.NEXT_PUBLIC_FORMSPREE_ENDPOINT;
    if (!endpoint) {
      setWaitlistError("Waitlist form is not configured yet. Please try again later.");
      return;
    }

    setWaitlistError(null);
    setIsWaitlistSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("email", trimmed);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Formspree submission failed");
      }

      setWaitlistSubmitted(true);
    } catch {
      setWaitlistError("We could not save your email. Please check your connection and try again.");
    } finally {
      setIsWaitlistSubmitting(false);
    }
  }

  function scrollToWaitlist() {
    document.getElementById("waitlist")?.scrollIntoView({ behavior: "smooth" });
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
        (result.service !== "OpenAI" && result.service !== "Anthropic")
      ) {
        throw new Error(
          result.error ??
            "We could not find a clear OpenAI or Anthropic USD total.",
        );
      }

      setScanStep(2);
      const amountUsd = result.amountUsd;
      const serviceName: SupportedService =
        result.service === "OpenAI" ? "OpenAI API" : "Anthropic API";
      const existingAmount =
        serviceAmounts[serviceName] ??
        services.find((service) => service.name === serviceName)?.amount ??
        0;
      const scan: BillingScan = {
        id: crypto.randomUUID(),
        service: serviceName,
        amountUsd,
        billingPeriod: result.billingPeriod ?? null,
        confidence: result.confidence ?? "medium",
        scannedAt: new Date().toISOString(),
      };

      setServiceAmounts((current) => ({
        ...current,
        [serviceName]: amountUsd,
      }));
      setSpent((current) => current - existingAmount + amountUsd);
      setScanStatus("success");
      setScanMessage(
        `${serviceName} · $${amountUsd.toFixed(2)} saved to your dashboard`,
      );
      setLastSyncedAt(
        new Date().toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
      setScanHistory((current) => {
        const next = [scan, ...current].slice(0, 25);
        window.localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(next));
        return next;
      });
    } catch (error) {
      setScanStatus("error");
      setScanMessage(
        error instanceof Error
          ? error.message
          : "The billing scanner could not analyze this image.",
      );
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
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="font-serif text-[22px] tracking-[-0.02em] text-bone">
              ToRay<span className="text-mint">.</span>
            </span>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-4">
            <span className="hidden text-sm text-bone-muted lg:block">
              Live scanner · OpenAI Vision
            </span>
            <div className="hidden max-w-xs md:block">
              <WaitlistForm
                email={waitlistEmail}
                onEmailChange={setWaitlistEmail}
                submitted={waitlistSubmitted}
                isSubmitting={isWaitlistSubmitting}
                onSubmit={handleWaitlistSubmit}
                variant="compact"
              />
            </div>
            <button
              type="button"
              onClick={scrollToWaitlist}
              className="rounded-full bg-sage px-4 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow md:hidden"
            >
              Join Waitlist
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="flex items-end justify-between py-12 md:py-14">
          <div>
            <Eyebrow>July 2026 — Live overview</Eyebrow>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
              Know your AI burn
              <br className="hidden md:block" /> before your card does.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-bone-muted">
              Every API and AI subscription on one calm dashboard — with an
              end-of-month projection, so overspend never surprises you again.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <span className="flex -space-x-2">
                {["bg-mint", "bg-clay", "bg-blush", "bg-sage-soft"].map((c) => (
                  <span key={c} className={`h-6 w-6 rounded-full ${c} ring-2 ring-background`} />
                ))}
              </span>
              <span className="flex items-center gap-1 text-[13px] text-bone-muted">
                <Star className="h-3.5 w-3.5 fill-clay text-clay" />
                Join the waitlist — it&apos;s free
              </span>
            </div>
          </div>
          <p className="hidden text-sm text-bone-muted md:block">
            {lastSyncedAt ? `Last synced ${lastSyncedAt}` : "Last synced —"}
          </p>
        </div>

        <ValidationPhaseBanner
          email={waitlistEmail}
          onEmailChange={setWaitlistEmail}
          submitted={waitlistSubmitted}
          isSubmitting={isWaitlistSubmitting}
          onSubmit={handleWaitlistSubmit}
        />
        {waitlistError && (
          <p className="-mt-4 mb-6 text-center text-sm text-warning">{waitlistError}</p>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Spend / Budget</Eyebrow>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${isOverPace ? "bg-danger/20 text-danger" : "bg-sage/25 text-mint"}`}>
                {isOverPace ? "Over pace" : "On track"}
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
                {isOverPace
                  ? `Projected $${projected.toFixed(0)} by Jul 31 — $${overspend.toFixed(0)} over budget`
                  : `Projected $${projected.toFixed(0)} by Jul 31`}
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Idle spend found</Eyebrow>
              <span className="rounded-full bg-clay/20 px-2.5 py-1 text-[11px] font-medium text-clay">Save now</span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-clay">${IDLE_WASTE.toFixed(2)}</span>
              <span className="text-sm text-bone-muted">/mo</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              GitHub Copilot — untouched for 23 days, still billing.
            </p>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>Next renewal</Eyebrow>
              <span className="rounded-full bg-clay/20 px-2.5 py-1 text-[11px] font-medium text-clay">In 4 days</span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">4</span>
              <span className="text-sm text-bone-muted">days — Jul 17</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">ChatGPT Plus · $20.00</p>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8 lg:col-span-3">
            <div className="flex items-center justify-between">
              <Eyebrow>Connected services</Eyebrow>
              <button className="inline-flex items-center gap-1 text-sm text-sage-soft transition hover:text-bone">
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <ul className="mt-6 space-y-3">
              {services.map((service) => {
                const status = statusConfig[service.status];
                return (
                  <li key={service.name} className="flex items-center gap-4 rounded-2xl bg-surface-raised/70 px-4 py-4 transition duration-180 hover:bg-surface-raised">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-serif text-sm ${service.accent}`}>
                      {service.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-bone">{service.name}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.chip}`}>{status.label}</span>
                      </div>
                      <p className="mt-1 text-[13px] text-bone-muted">{service.type} · {service.renewal}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums text-bone">
                        ${(serviceAmounts[service.name as SupportedService] ?? service.amount).toFixed(2)}
                      </p>
                      <p className="text-[11px] text-bone-muted">{service.isUsageBased ? "This month" : "Monthly"}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex items-center justify-between rounded-2xl bg-clay/10 px-4 py-3">
              <p className="text-[13px] text-clay">
                You could save ${IDLE_WASTE.toFixed(2)}/mo by pausing idle tools
              </p>
              <button type="button" onClick={scrollToWaitlist} className="shrink-0 text-[13px] font-medium text-clay underline-offset-4 transition hover:underline">
                Get launch updates →
              </button>
            </div>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8">
              <div className="flex items-center justify-between">
                <Eyebrow>Quick scan</Eyebrow>
                <span className="text-[12px] text-mint">
                  {scanHistory.length} saved locally
                </span>
              </div>

              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileChange} />

              <div
                onDragOver={(e) => { e.preventDefault(); if (!isScanning) setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative mt-5 flex min-h-[260px] flex-col items-center justify-center overflow-hidden rounded-[24px] border border-dashed px-6 text-center transition duration-180 ${isDragging ? "border-sage-soft bg-sage/15" : "border-hairline bg-background/40"} ${isScanning ? "pointer-events-none" : ""}`}
              >
                {isScanning && (
                  <span aria-hidden className="animate-toray-scan pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sage-soft to-transparent" />
                )}

                {isScanning ? (
                  <ScanLoader stepIndex={scanStep} />
                ) : (
                  <>
                    {previewUrl && scanStatus === "success" ? (
                      <div className="mb-4 overflow-hidden rounded-2xl border border-hairline">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Uploaded usage screenshot" className="h-16 w-28 object-cover opacity-80" />
                      </div>
                    ) : (
                      <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-sage/20">
                        <ScanLine className={`h-6 w-6 transition-colors ${isDragging ? "text-sage-soft" : "text-sage-soft/70"}`} strokeWidth={1.5} />
                      </div>
                    )}
                    <h3 className="mt-3 font-serif text-xl text-bone">Scan a billing screenshot</h3>
                    <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-bone-muted">
                      Upload an OpenAI or Anthropic usage screen. It is sent securely to OpenAI Vision for analysis and is not stored by ToRay.
                    </p>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-6 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow">
                      Choose file
                    </button>
                    <p className="mt-4 text-[11px] tracking-wide text-bone-muted/70">PNG / JPG — Max 10MB · Saved totals stay in this browser</p>
                  </>
                )}
              </div>

              {scanMessage && (
                <p className={`mt-4 text-[13px] ${scanStatus === "error" ? "text-warning" : scanStatus === "success" ? "text-mint" : "text-bone-muted"}`}>
                  {scanMessage}
                  {scanStatus === "success" && !waitlistSubmitted && (
                    <>
                      {" "}
                      <button type="button" onClick={scrollToWaitlist} className="text-sage-soft underline-offset-4 hover:underline">
                        Join the waitlist for launch →
                      </button>
                    </>
                  )}
                </p>
              )}
            </div>

            <div className="rounded-[28px] border border-sage/40 bg-gradient-to-b from-sage/20 to-surface p-6 md:p-8">
              <div className="flex items-center justify-between">
                <Eyebrow>Launch waitlist</Eyebrow>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-medium text-mint">Founding price</span>
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-serif text-4xl tracking-[-0.02em] text-bone">$12</span>
                <span className="text-sm text-bone-muted">/mo at launch — free to join now</span>
              </div>
              <ul className="mt-6 space-y-3">
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
              <div className="mt-7">
                <WaitlistForm
                  email={waitlistEmail}
                  onEmailChange={setWaitlistEmail}
                  submitted={waitlistSubmitted}
                  isSubmitting={isWaitlistSubmitting}
                  onSubmit={handleWaitlistSubmit}
                  variant="default"
                />
              </div>
              <p className="mt-3 text-center text-[12px] text-bone-muted">
                Free pre-order. No payment until we officially launch.
              </p>
            </div>

            <figure className="px-2">
              <blockquote className="text-[13.5px] leading-relaxed text-bone-muted">
                &ldquo;This is exactly the dashboard I wish existed before my OpenAI bill doubled.&rdquo;
              </blockquote>
              <figcaption className="mt-2 flex items-center gap-2 text-[12px] text-bone-muted/70">
                <span className="h-5 w-5 rounded-full bg-blush/40" />
                Alex R. — solo founder, shipping with GPT-4o
              </figcaption>
            </figure>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 text-[12px] text-bone-muted">
          <span>© 2026 ToRay</span>
          <span>All spend data stays in your browser</span>
        </div>
      </footer>
    </div>
  );
}
