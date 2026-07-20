declare global {
  interface Window {
    fbq?: (
      command: "track" | "trackCustom" | "init" | "consent",
      eventOrId: string,
      params?: Record<string, unknown>,
    ) => void;
  }
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
}) {
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
