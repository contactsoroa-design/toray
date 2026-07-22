declare global {
  interface Window {
    fbq?: (
      command: "track" | "trackCustom" | "init" | "consent",
      eventOrId: string,
      params?: Record<string, unknown>,
      options?: { eventID?: string },
    ) => void;
  }
}

function pixelId(): string {
  return process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ?? "";
}

function withFbq(
  run: (fbq: NonNullable<Window["fbq"]>) => void,
  attemptsLeft = 40,
) {
  if (typeof window === "undefined") return;
  if (typeof window.fbq === "function") {
    try {
      run(window.fbq);
    } catch (error) {
      console.error("[meta-pixel] fbq call failed", error);
    }
    return;
  }
  if (attemptsLeft <= 0) {
    console.warn("[meta-pixel] fbq not available");
    return;
  }
  window.setTimeout(() => withFbq(run, attemptsLeft - 1), 50);
}

/**
 * Advanced matching: re-init with email when known (signed-in users).
 * Plain email is fine — the Pixel hashes it before send.
 */
export function identifyMetaUser(email: string | null | undefined) {
  const id = pixelId();
  if (!id) return;
  withFbq((fbq) => {
    const trimmed = email?.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      fbq("init", id);
      return;
    }
    fbq("init", id, { em: trimmed });
  });
}

/** Standard Meta Pixel event (Lead, PageView, Purchase, …). */
export function trackMetaEvent(
  event: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) {
  withFbq((fbq) => {
    // Prefer 3-arg form for Pixel Helper / older stub compatibility.
    // eventID is still sent for CAPI dedupe via custom params when provided.
    const payload = options?.eventID
      ? { ...params, event_id: options.eventID }
      : params;
    fbq("track", event, payload);
  });
}

/** Custom event for Events Manager + funnel diagnosis. */
export function trackMetaCustom(
  event: string,
  params?: Record<string, unknown>,
) {
  withFbq((fbq) => {
    fbq("trackCustom", event, params);
  });
}

/** Shared with Conversions API for browser/CAPI dedupe. */
export function newMetaEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Primary product KPI: successful Vision billing read. */
export function trackScanComplete(params: {
  source: "upload" | "sample" | "pro_gate";
  service: string;
  amountUsd: number;
  email?: string | null;
  eventId?: string;
}): string {
  if (params.email) {
    identifyMetaUser(params.email);
  }
  const eventId = params.eventId ?? newMetaEventId();
  const leadParams = {
    content_name: "billing_scan",
    content_category: params.source,
    value: params.amountUsd,
    currency: "USD",
    event_id: eventId,
  };

  withFbq((fbq) => {
    fbq("track", "Lead", leadParams);
    fbq("trackCustom", "ScanComplete", {
      source: params.source,
      service: params.service,
      amount_usd: params.amountUsd,
      event_id: eventId,
    });
  });
  return eventId;
}
