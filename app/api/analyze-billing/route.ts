import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isFoundingForSession } from "@/lib/founding";
import {
  FOUNDING_VISION_PROVIDERS,
  FREE_VISION_PROVIDERS,
  isVisionProvider,
} from "@/lib/vision-providers";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALL_VISION_PROVIDERS = [
  ...FREE_VISION_PROVIDERS,
  ...FOUNDING_VISION_PROVIDERS,
  "Other",
] as const;

type BillingAnalysis = {
  service: (typeof ALL_VISION_PROVIDERS)[number] | null;
  amountUsd: number | null;
  billingPeriod: string | null;
  confidence: "high" | "medium" | "low";
};

function isBillingAnalysis(value: unknown): value is BillingAnalysis {
  if (!value || typeof value !== "object") return false;

  const analysis = value as Record<string, unknown>;
  const validServices = new Set<unknown>([...ALL_VISION_PROVIDERS, null]);
  const service = validServices.has(analysis.service)
    ? (analysis.service as BillingAnalysis["service"])
    : undefined;
  const confidence =
    analysis.confidence === "high" ||
    analysis.confidence === "medium" ||
    analysis.confidence === "low"
      ? analysis.confidence
      : undefined;

  return (
    service !== undefined &&
    (analysis.amountUsd === null ||
      (typeof analysis.amountUsd === "number" &&
        Number.isFinite(analysis.amountUsd) &&
        analysis.amountUsd >= 0)) &&
    (analysis.billingPeriod === null ||
      typeof analysis.billingPeriod === "string") &&
    confidence !== undefined
  );
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
    const founding = await isFoundingForSession(supabase);

    const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 260,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "billing_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              service: {
                anyOf: [
                  {
                    type: "string",
                    enum: ["OpenAI", "Anthropic", "Gemini", "Grok", "Other"],
                  },
                  { type: "null" },
                ],
              },
              amountUsd: {
                anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
              },
              billingPeriod: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
            },
            required: ["service", "amountUsd", "billingPeriod", "confidence"],
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You are ToRay's strict billing-screenshot classifier and OCR engine.",
            "Extract current-period usage/billing totals from supported cloud consoles only.",
            "",
            "PROVIDER IDENTIFICATION (do this first; never skip):",
            "- Default assumption: the image is NOT a supported billing screen. Prefer service=Other or null unless evidence is clear.",
            "- OpenAI: ONLY OpenAI Platform / API billing (platform.openai.com, usage.openai.com, org Usage/Billing/Cost). ChatGPT consumer (chatgpt.com, Plus/Pro settings) → Other.",
            "- Anthropic: ONLY Anthropic Console / Claude API (console.anthropic.com, Workspaces Usage/Billing/Cost).",
            "- Gemini: ONLY Google AI Studio / Gemini API / Cloud billing for Gemini API (aistudio.google.com, Google AI usage/billing chrome, Gemini API cost tables). Consumer Gemini app subscription alone → Other.",
            "- Grok: ONLY xAI / Grok API console billing/usage (console.x.ai or clear xAI API usage/billing chrome). Consumer grok.x.ai chat subscription alone → Other.",
            "- Also reject as Other/null: Midjourney, Cursor, GitHub Copilot, Perplexity, Replicate, Hugging Face, Stripe receipts, bank statements, invoices, email receipts, random photos.",
            "- If branding is mixed, cropped, blurred, or only a generic dollar amount is visible → service=Other or null, confidence=low, amountUsd=null.",
            "",
            "AMOUNT EXTRACTION (only after a supported provider is confirmed):",
            "- amountUsd must be the explicit current-period total spend / total usage / total cost.",
            "- Ignore credits, prepaid balance, payment due, tax-only lines, plan prices, projected spend, and single line-items when a period total exists.",
            "- Never invent or sum line items. If the period total is missing → amountUsd=null and confidence=low.",
            "- Copy the visible billing period into billingPeriod when present; otherwise null.",
            "- USD only.",
            "",
            "CONFIDENCE:",
            "- high: provider identity and period total are unmistakable.",
            "- medium: provider is clear but layout is partially cropped.",
            "- low: provider or total is uncertain. If low, set service to Other or null and amountUsd to null.",
            "",
            "Return only JSON matching the schema.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Classify this screenshot first.",
                "If it is not a clear supported billing/usage console, return service=Other (or null), amountUsd=null, confidence=low.",
                "Supported providers: OpenAI Platform, Anthropic Console, Google AI Studio/Gemini API billing, xAI/Grok API billing.",
                "Only if the provider is clearly supported, extract the current-period USD total.",
              ].join(" "),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${image.type};base64,${imageBase64}`,
                detail: "high",
              },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      return NextResponse.json(
        { error: "We could not read a billing total from this screenshot." },
        { status: 422 },
      );
    }

    const parsed: unknown = JSON.parse(content);
    if (!isBillingAnalysis(parsed)) {
      return NextResponse.json(
        { error: "We could not find a clear USD billing total in this screenshot." },
        { status: 422 },
      );
    }

    if (
      !isVisionProvider(parsed.service) ||
      parsed.amountUsd === null ||
      parsed.confidence === "low"
    ) {
      return NextResponse.json(
        {
          error:
            "This does not look like a clear supported billing console. Enter the amount manually, or upload a usage/billing screenshot.",
          service: parsed.service,
          confidence: parsed.confidence,
        },
        { status: 422 },
      );
    }

    const provider = parsed.service;
    const isFreeProvider = (FREE_VISION_PROVIDERS as readonly string[]).includes(
      provider,
    );
    const isFoundingProvider = (
      FOUNDING_VISION_PROVIDERS as readonly string[]
    ).includes(provider);

    if (isFoundingProvider && !founding) {
      return NextResponse.json(
        {
          error:
            "Gemini and Grok Vision scanning is included with ToRay Pro — $12/mo. Enter the amount manually within your free tool limit, or upgrade.",
          code: "FOUNDING_REQUIRED",
          service: provider,
          confidence: parsed.confidence,
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
      amountUsd: Math.round(parsed.amountUsd * 100) / 100,
      billingPeriod: parsed.billingPeriod,
      confidence: parsed.confidence,
      foundingUnlock: isFoundingProvider,
    });
  } catch (error) {
    console.error("[analyze-billing]", error);
    return NextResponse.json(
      { error: "The billing scanner could not analyze this image. Please try again." },
      { status: 502 },
    );
  }
}
