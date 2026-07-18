import { NextResponse } from "next/server";
import Stripe from "stripe";
import { markFoundingMember, normalizeEmail } from "@/lib/founding";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Called after Stripe Payment Link redirects back with ?stripe_session_id=...
 * Verifies the Checkout Session server-side and records ToRay Pro entitlement.
 */
export async function GET(request: Request) {
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Stripe is not configured.", isFounding: false },
      { status: 503 },
    );
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json(
      { error: "Missing session_id.", isFounding: false },
      { status: 400 },
    );
  }

  try {
    const stripe = new Stripe(apiKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (
      session.payment_status !== "paid" &&
      session.payment_status !== "no_payment_required"
    ) {
      return NextResponse.json({
        isFounding: false,
        status: session.payment_status,
      });
    }

    const email =
      session.customer_details?.email ||
      session.customer_email ||
      null;

    if (!email) {
      return NextResponse.json(
        { error: "Checkout email missing.", isFounding: false },
        { status: 422 },
      );
    }

    await markFoundingMember({
      email: normalizeEmail(email),
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : null,
      stripeSessionId: session.id,
    });

    // If the browser is already signed in as that email, stamp local preference.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const matchesUser =
      !!user?.email && normalizeEmail(user.email) === normalizeEmail(email);

    return NextResponse.json({
      isFounding: true,
      email: normalizeEmail(email),
      matchesSignedInUser: matchesUser,
    });
  } catch (error) {
    console.error("[stripe/confirm]", error);
    return NextResponse.json(
      { error: "Could not verify checkout session.", isFounding: false },
      { status: 502 },
    );
  }
}
