declare global {
  interface Window {
    fbq?: (
      command: "track" | "trackCustom" | "init" | "consent",
      eventOrId: string,
      params?: Record<string, unknown>,
    ) => void;
  }
}

function pixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
}

/**
 * Advanced matching: re-init with email when known (signed-in users).
 * Improves Event Match Quality so Meta can attribute Leads to people.
 * Plain email is fine — the Pixel hashes it before send.
 */
export function identifyMetaUser(email: string | null | undefined) {
  const id = pixelId();
  if (!id || typeof window === "undefined" || typeof window.fbq !== "function") {
    return;
  }
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    window.fbq("init", id);
    return;
  }
  window.fbq("init", id, { em: trimmed });
}

/** Standard Meta Pixel event (Lead, PageView, Purchase, …). */
export function trackMetaEvent(
  event: string,
  params?: Record<string, unknown>,
) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") {
    return;
  }
  window.fbq("track", event, params);
}

/** Custom event for Events Manager + funnel diagnosis. */
export function trackMetaCustom(
  event: string,
  params?: Record<string, unknown>,
) {
  if (typeof window === "undefined" || typeof window.fbq !== "function") {
    return;
  }
  window.fbq("trackCustom", event, params);
}

/** Primary product KPI: successful Vision billing scan. */
export function trackScanComplete(params: {
  source: "upload" | "sample";
  service: string;
  amountUsd: number;
  /** Signed-in email — improves EMQ when present. */
  email?: string | null;
}) {
  if (params.email) {
    identifyMetaUser(params.email);
  }
  trackMetaEvent("Lead", {
    content_name: "billing_scan",
    content_category: params.source,
    value: params.amountUsd,
    currency: "USD",
  });
  trackMetaCustom("ScanComplete", {
    source: params.source,
    service: params.service,
    amount_usd: params.amountUsd,
  });
}
