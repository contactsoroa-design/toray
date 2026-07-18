import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  billingVisionRejectReason,
  isBillingVisionAnalysis,
  isFoundingVisionProvider,
  isFreeVisionProvider,
  runBillingVisionCompletion,
  shouldEscalateVisionModel,
  type BillingVisionAnalysis,
} from "@/lib/billing-vision";
import { isFoundingForSession } from "@/lib/founding";
import { isVisionProvider } from "@/lib/vision-providers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const PRIMARY_MODEL = "gpt-4o-mini";
const ESCALATION_MODEL = "gpt-4o";

/** Eval / local only — never enable in production. */
function allowFoundingBypass(): boolean {
  return (
    process.env.BILLING_EVAL_ALLOW_FOUNDING === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

async function analyzeImage(
  openai: OpenAI,
  imageType: string,
  imageBase64: string,
): Promise<BillingVisionAnalysis | null> {
  const first = await runBillingVisionCompletion(openai, {
    model: PRIMARY_MODEL,
    imageType,
    imageBase64,
  });
  const firstContent = first.choices[0]?.message.content;
  if (!firstContent) return null;

  let parsed: unknown = JSON.parse(firstContent);
  if (!isBillingVisionAnalysis(parsed)) return null;

  if (shouldEscalateVisionModel(parsed)) {
    const second = await runBillingVisionCompletion(openai, {
      model: ESCALATION_MODEL,
      imageType,
      imageBase64,
    });
    const secondContent = second.choices[0]?.message.content;
    if (secondContent) {
      const secondParsed: unknown = JSON.parse(secondContent);
      if (isBillingVisionAnalysis(secondParsed)) {
        parsed = secondParsed;
      }
    }
  }

  return parsed as BillingVisionAnalysis;
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "The billing scanner is not configured yet." },
      { status: 503 },
    );
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Please upload a screenshot image." },
        { status: 400 },
      );
    }

    const image = formData.get("image");

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Please upload a screenshot image." },
        { status: 400 },
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "Use a PNG, JPEG, or WebP image." },
        { status: 400 },
      );
    }

    if (image.size === 0 || image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Use an image smaller than 10MB." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const founding =
      (await isFoundingForSession(supabase)) || allowFoundingBypass();

    const imageBase64 = Buffer.from(await image.arrayBuffer()).toString(
      "base64",
    );
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const parsed = await analyzeImage(openai, image.type, imageBase64);
    if (!parsed) {
      return NextResponse.json(
        { error: "We could not find a clear USD billing total in this screenshot." },
        { status: 422 },
      );
    }

    const rejectReason = billingVisionRejectReason(parsed);
    if (rejectReason || !isVisionProvider(parsed.service)) {
      const currencyHint =
        rejectReason === "non_usd"
          ? " ToRay only reads USD totals from supported consoles."
          : "";
      return NextResponse.json(
        {
          error:
            `This does not look like a clear supported USD billing console.${currencyHint} Enter the amount manually, or upload a usage/billing screenshot.`,
          service: parsed.service,
          confidence: parsed.confidence,
          currencyCode: parsed.currencyCode,
          amountKind: parsed.amountKind,
          reason: rejectReason,
        },
        { status: 422 },
      );
    }

    const provider = parsed.service;
    const amountUsd = Math.round((parsed.amountUsd as number) * 100) / 100;
    const isFreeProvider = isFreeVisionProvider(provider);
    const isFoundingProvider = isFoundingVisionProvider(provider);

    if (isFoundingProvider && !founding) {
      return NextResponse.json(
        {
          error:
            "Gemini, Grok, Cursor, and Copilot Vision scanning is included with ToRay Pro — $12/mo. We prefilled the amount when we could — enter it manually within your free tool limit, or upgrade.",
          code: "FOUNDING_REQUIRED",
          service: provider,
          amountUsd,
          billingPeriod: parsed.billingPeriod,
          confidence: parsed.confidence,
          currencyCode: parsed.currencyCode,
        },
        { status: 402 },
      );
    }

    if (!isFreeProvider && !isFoundingProvider) {
      return NextResponse.json(
        {
          error:
            "This provider is not supported for screenshot scan yet. Enter the amount manually.",
          service: provider,
          confidence: parsed.confidence,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      service: provider,
      amountUsd,
      billingPeriod: parsed.billingPeriod,
      confidence: parsed.confidence,
      currencyCode: parsed.currencyCode,
      foundingUnlock: isFoundingProvider,
    });
  } catch (error) {
    console.error("[analyze-billing]", error);
    return NextResponse.json(
      {
        error:
          "The billing scanner could not analyze this image. Please try again.",
      },
      { status: 502 },
    );
  }
}
