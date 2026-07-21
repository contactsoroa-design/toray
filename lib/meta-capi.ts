/**
 * Meta Conversions API (server-side) — survives ad blockers that drop browser Pixel.
 * Set META_CAPI_ACCESS_TOKEN from Events Manager → Settings → Generate access token.
 */

const GRAPH_VERSION = "v21.0";

export type CapIUserData = {
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  email?: string | null;
};

export type CapILeadParams = {
  eventId: string;
  eventSourceUrl?: string;
  value?: number;
  contentCategory?: string;
  service?: string;
  userData?: CapIUserData;
};

function pixelId(): string {
  return (
    process.env.META_PIXEL_ID?.trim() ||
    process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() ||
    ""
  );
}

function accessToken(): string {
  return process.env.META_CAPI_ACCESS_TOKEN?.trim() || "";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA-256 hex for CAPI user_data fields (email). */
async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Send a Lead event via Conversions API. No-ops if token/pixel missing.
 * Never throws to callers — logs and returns false on failure.
 */
export async function sendMetaCapILead(
  params: CapILeadParams,
): Promise<boolean> {
  const id = pixelId();
  const token = accessToken();
  if (!id || !token) return false;

  const userData: Record<string, string> = {};
  const u = params.userData;
  if (u?.clientIpAddress) userData.client_ip_address = u.clientIpAddress;
  if (u?.clientUserAgent) userData.client_user_agent = u.clientUserAgent;
  if (u?.fbp) userData.fbp = u.fbp;
  if (u?.fbc) userData.fbc = u.fbc;
  if (u?.email?.includes("@")) {
    userData.em = await sha256(normalizeEmail(u.email));
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const body = {
    data: [
      {
        event_name: "Lead",
        event_time: eventTime,
        event_id: params.eventId,
        action_source: "website",
        event_source_url:
          params.eventSourceUrl ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          "https://toray.vercel.app/",
        user_data: userData,
        custom_data: {
          content_name: "billing_scan",
          content_category: params.contentCategory ?? "upload",
          currency: "USD",
          ...(typeof params.value === "number" ? { value: params.value } : {}),
          ...(params.service ? { service: params.service } : {}),
        },
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${id}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[meta-capi] Lead failed", res.status, text.slice(0, 400));
      return false;
    }
    return true;
  } catch (error) {
    console.error("[meta-capi] Lead error", error);
    return false;
  }
}

export function readMetaCookies(cookieHeader: string | null): {
  fbp: string | null;
  fbc: string | null;
} {
  if (!cookieHeader) return { fbp: null, fbc: null };
  let fbp: string | null = null;
  let fbc: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key === "_fbp") fbp = value;
    if (key === "_fbc") fbc = value;
  }
  return { fbp, fbc };
}
