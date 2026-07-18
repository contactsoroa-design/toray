import { NextResponse } from "next/server";
import {
  isFeedbackCategory,
  isFeedbackContext,
} from "@/lib/feedback";
import { isFoundingForSession } from "@/lib/founding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_MESSAGE = 2000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  // Honeypot — bots fill hidden fields; pretend success.
  if (typeof payload.company === "string" && payload.company.trim()) {
    return NextResponse.json({ ok: true });
  }

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: "Enter a short message (1–2000 characters)." },
      { status: 400 },
    );
  }

  if (!isFeedbackCategory(payload.category)) {
    return NextResponse.json({ error: "Pick a category." }, { status: 400 });
  }

  if (!isFeedbackContext(payload.context)) {
    return NextResponse.json({ error: "Missing context." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isSignedIn = Boolean(user?.email);
  const isPro = isSignedIn ? await isFoundingForSession(supabase) : false;
  const email =
    isSignedIn && user?.email
      ? user.email
      : typeof payload.email === "string" && payload.email.includes("@")
        ? payload.email.trim().toLowerCase()
        : null;

  const { error } = await supabase.from("feedback").insert({
    message,
    category: payload.category,
    context: payload.context,
    is_signed_in: isSignedIn,
    email,
    is_pro: isPro,
    path: typeof payload.path === "string" ? payload.path.slice(0, 200) : null,
    user_agent:
      typeof payload.userAgent === "string"
        ? payload.userAgent.slice(0, 300)
        : null,
    user_id: user?.id ?? null,
  });

  if (error) {
    console.error("[feedback]", error);
    return NextResponse.json(
      { error: "Could not save feedback. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
