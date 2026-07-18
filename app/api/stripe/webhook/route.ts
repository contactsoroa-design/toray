import { NextResponse } from "next/server";
import Stripe from "stripe";
import { markFoundingMember, normalizeEmail } from "@/lib/founding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;

  if (!secret || !apiKey) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  }

  const stripe = new Stripe(apiKey);
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error("[stripe/webhook] signature", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "unpaid") {
        return NextResponse.json({ received: true, skipped: "unpaid" });
      }

      const email =
        session.customer_details?.email ||
        session.customer_email ||
        null;

      if (!email) {
        console.error("[stripe/webhook] missing email on session", session.id);
        return NextResponse.json({ received: true, skipped: "no_email" });
      }

      await markFoundingMember({
        email: normalizeEmail(email),
        stripeCustomerId:
          typeof session.customer === "string" ? session.customer : null,
        stripeSessionId: session.id,
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe/webhook]", error);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
