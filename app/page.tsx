"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus, ScanLine } from "lucide-react";

const BUDGET = 200;
const INITIAL_SPENT = 142.5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const SCAN_DURATION_MS = 3000;

type ServiceStatus = "active" | "warning" | "paused";
type ScanStatus = "idle" | "scanning" | "success" | "error";

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
    type: "従量課金",
    amount: 68.2,
    isUsageBased: true,
    renewal: "毎月1日リセット",
    status: "warning",
    accent: "bg-clay/20 text-clay",
  },
  {
    name: "Anthropic API",
    type: "従量課金",
    amount: 24.3,
    isUsageBased: true,
    renewal: "毎月1日リセット",
    status: "active",
    accent: "bg-blush/20 text-blush",
  },
  {
    name: "ChatGPT Plus",
    type: "サブスク",
    amount: 20.0,
    isUsageBased: false,
    renewal: "7月17日 更新",
    status: "active",
    accent: "bg-mint/20 text-mint",
  },
  {
    name: "Midjourney",
    type: "サブスク",
    amount: 30.0,
    isUsageBased: false,
    renewal: "7月22日 更新",
    status: "active",
    accent: "bg-moss/25 text-sage-soft",
  },
  {
    name: "GitHub Copilot",
    type: "サブスク",
    amount: 10.0,
    isUsageBased: false,
    renewal: "7月28日 更新",
    status: "paused",
    accent: "bg-bone/10 text-bone-muted",
  },
];

const statusConfig: Record<ServiceStatus, { label: string; chip: string }> = {
  active: {
    label: "稼働中",
    chip: "bg-mint/15 text-mint",
  },
  warning: {
    label: "予算注意",
    chip: "bg-clay/20 text-clay",
  },
  paused: {
    label: "停止中",
    chip: "bg-bone/5 text-bone-muted",
  },
};

const SCAN_STEPS = [
  "画像を読み込み中…",
  "請求項目を検出中…",
  "合計金額を抽出中…",
];

function generateFakeAmount(previous: number): number {
  let next = previous;
  for (let i = 0; i < 6; i++) {
    const candidate = Math.round((160 + Math.random() * 35) * 100) / 100;
    if (Math.abs(candidate - previous) >= 5) {
      next = candidate;
      break;
    }
    next = candidate;
  }
  return next;
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
      <path
        d="M10 21 L22 11"
        stroke="#F5F0E8"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 15.5 L16.5 11"
        stroke="#F5F0E8"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <path
        d="M15.5 21 L22 15.5"
        stroke="#F5F0E8"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

/** 目盛り式メーター：セージ→ミント→クレイと色が移る */
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

      <p className="mt-5 font-serif text-xl text-bone">AIが画像を解析中...</p>
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
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [spent, setSpent] = useState(INITIAL_SPENT);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const animatedSpent = useAnimatedNumber(spent);
  const spentRatio = Math.min((animatedSpent / BUDGET) * 100, 100);
  const remaining = Math.max(BUDGET - animatedSpent, 0);
  const isScanning = scanStatus === "scanning";

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearScanTimers() {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    if (stepTimerRef.current) clearInterval(stepTimerRef.current);
    scanTimerRef.current = null;
    stepTimerRef.current = null;
  }

  function runFakeScan(file: File) {
    if (!ALLOWED_TYPES.has(file.type)) {
      setScanStatus("error");
      setScanMessage("PNG / JPEG / WebP のみ対応しています");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setScanStatus("error");
      setScanMessage("ファイルサイズは10MB以下にしてください");
      return;
    }

    clearScanTimers();

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    setScanStatus("scanning");
    setScanMessage(null);
    setScanStep(0);

    stepTimerRef.current = setInterval(() => {
      setScanStep((prev) => Math.min(prev + 1, SCAN_STEPS.length - 1));
    }, SCAN_DURATION_MS / SCAN_STEPS.length);

    scanTimerRef.current = setTimeout(() => {
      clearScanTimers();

      const amount = generateFakeAmount(spent);
      setSpent(amount);
      setScanStatus("success");
      setScanMessage(`$${amount.toFixed(2)} を読み取りました`);
      setLastSyncedAt(
        new Date().toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Tokyo",
        }),
      );
    }, SCAN_DURATION_MS);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) runFakeScan(file);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isScanning) return;
    const file = event.dataTransfer.files?.[0];
    if (file) runFakeScan(file);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background font-sans text-bone selection:bg-sage/40">
      {/* Hers風の深いセージ＋クレイの雰囲気 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(111,158,124,0.22),_transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-40 h-80 w-80 rounded-full bg-clay/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 bottom-32 h-72 w-72 rounded-full bg-blush/10 blur-3xl"
      />

      <header className="relative z-10 border-b border-hairline">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="font-serif text-[22px] tracking-[-0.02em] text-bone">
              ToRay
            </span>
          </div>

          <div className="flex items-center gap-5">
            <span className="hidden text-sm text-bone-muted sm:block">
              Free プラン
            </span>
            <a
              href="https://buy.stripe.com/example"
              className="inline-flex items-center gap-1.5 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow"
            >
              Proにアップグレード
              <ArrowUpRight className="h-3.5 w-3.5 opacity-80" />
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-6 pb-24">
        <div className="flex items-end justify-between py-12 md:py-16">
          <div>
            <Eyebrow>Overview — 2026年7月</Eyebrow>
            <h1 className="mt-3 font-serif text-4xl font-medium tracking-[-0.02em] text-bone md:text-5xl">
              今月のAI支出
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-bone-muted">
              トークン消費とサブスク予算を、ひとつのやさしい画面で。
            </p>
          </div>
          <p className="hidden text-sm text-bone-muted md:block">
            {lastSyncedAt ? `最終同期 ${lastSyncedAt} JST` : "最終同期 —"}
          </p>
        </div>

        {/* サマリーカード */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>総支出 / 予算</Eyebrow>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  spentRatio >= 80
                    ? "bg-danger/20 text-danger"
                    : spentRatio >= 70
                      ? "bg-clay/20 text-clay"
                      : "bg-sage/25 text-mint"
                }`}
              >
                {spentRatio >= 80 ? "上限注意" : spentRatio >= 70 ? "やや高め" : "予算内"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span
                className={`font-serif text-4xl tracking-[-0.02em] tabular-nums transition-colors duration-500 ${
                  scanStatus === "success" ? "text-mint" : "text-bone"
                }`}
              >
                ${animatedSpent.toFixed(2)}
              </span>
              <span className="text-sm tabular-nums text-bone-muted">
                / ${BUDGET}
              </span>
            </div>
            <div className="mt-6">
              <Meter ratio={spentRatio} />
              <div className="mt-2.5 flex justify-between text-xs text-bone-muted">
                <span>{spentRatio.toFixed(0)}% 消化</span>
                <span>残り ${remaining.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>アクティブなツール</Eyebrow>
              <span className="flex -space-x-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-mint ring-2 ring-surface" />
                <span className="h-2.5 w-2.5 rounded-full bg-clay ring-2 ring-surface" />
                <span className="h-2.5 w-2.5 rounded-full bg-blush ring-2 ring-surface" />
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">
                5
              </span>
              <span className="text-sm text-bone-muted">個</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              従量課金 ×2　・　サブスク ×3
            </p>
          </div>

          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-7">
            <div className="flex items-center justify-between">
              <Eyebrow>次の請求</Eyebrow>
              <span className="rounded-full bg-clay/20 px-2.5 py-1 text-[11px] font-medium text-clay">
                あと4日
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-serif text-4xl tracking-[-0.02em] tabular-nums text-bone">
                4
              </span>
              <span className="text-sm text-bone-muted">日後 — 7月17日</span>
            </div>
            <p className="mt-6 text-sm leading-relaxed text-bone-muted">
              ChatGPT Plus　$20.00
            </p>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* サービス一覧 */}
          <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8 lg:col-span-3">
            <div className="flex items-center justify-between">
              <Eyebrow>接続中のサービス</Eyebrow>
              <button className="inline-flex items-center gap-1 text-sm text-sage-soft transition hover:text-bone">
                <Plus className="h-3.5 w-3.5" />
                追加
              </button>
            </div>

            <ul className="mt-6 space-y-3">
              {services.map((service) => {
                const status = statusConfig[service.status];
                return (
                  <li
                    key={service.name}
                    className="flex items-center gap-4 rounded-2xl bg-surface-raised/70 px-4 py-4 transition duration-180 hover:bg-surface-raised"
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
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.chip}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] text-bone-muted">
                        {service.type} ・ {service.renewal}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="font-medium tabular-nums text-bone">
                        ${service.amount.toFixed(2)}
                      </p>
                      <p className="text-[11px] text-bone-muted">
                        {service.isUsageBased ? "今月の消費" : "月額"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 text-right text-[13px] tabular-nums text-bone-muted">
              合計 $152.50{" "}
              <span className="text-bone/30">（予定額を含む）</span>
            </p>
          </div>

          {/* クイック分析 */}
          <div className="lg:col-span-2">
            <div className="rounded-[28px] border border-hairline bg-surface p-6 md:p-8">
              <Eyebrow>クイック分析</Eyebrow>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleFileChange}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isScanning) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`relative mt-5 flex min-h-[300px] flex-col items-center justify-center overflow-hidden rounded-[24px] border border-dashed px-6 text-center transition duration-180 ${
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
                      <div className="mb-4 overflow-hidden rounded-2xl border border-hairline">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="アップロードしたスクリーンショット"
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

                    <h3 className="mt-3 font-serif text-xl text-bone">
                      Usage画面をスキャン
                    </h3>
                    <p className="mt-2 max-w-[240px] text-[13px] leading-relaxed text-bone-muted">
                      OpenAI / Anthropic の利用料金画面をドロップすると、今月の合計金額を自動で読み取ります
                    </p>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-6 rounded-full bg-sage px-5 py-2.5 text-sm font-medium text-bone transition duration-180 hover:bg-sage-glow"
                    >
                      ファイルを選択
                    </button>

                    <p className="mt-4 text-[11px] tracking-wide text-bone-muted/70">
                      PNG / JPG — Max 10MB
                    </p>
                  </>
                )}
              </div>

              {scanMessage ? (
                <p
                  className={`mt-4 text-[13px] ${
                    scanStatus === "error"
                      ? "text-warning"
                      : scanStatus === "success"
                        ? "text-sage-soft"
                        : "text-bone-muted"
                  }`}
                >
                  {scanMessage}
                </p>
              ) : (
                <p className="mt-4 text-[13px] leading-relaxed text-bone-muted">
                  platform.openai.com のUsageページ全体をキャプチャすると精度が上がります
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 text-[12px] text-bone-muted">
          <span>© 2026 ToRay</span>
          <span>すべての支出データはローカルに保存されます</span>
        </div>
      </footer>
    </div>
  );
}
