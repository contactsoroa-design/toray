import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type BillingAnalysis = {
  service: "OpenAI" | "Anthropic" | "Other" | null;
  amountUsd: number | null;
  billingPeriod: string | null;
  confidence: "high" | "medium" | "low";
};

function isBillingAnalysis(value: unknown): value is BillingAnalysis {
  if (!value || typeof value !== "object") return false;

  const analysis = value as Record<string, unknown>;
  const validServices = new Set(["OpenAI", "Anthropic", "Other", null]);
  const validConfidence = new Set(["high", "medium", "low"]);
  const service =
    analysis.service === "OpenAI" ||
    analysis.service === "Anthropic" ||
    analysis.service === "Other" ||
    analysis.service === null
      ? analysis.service
      : undefined;
  const confidence =
    analysis.confidence === "high" ||
    analysis.confidence === "medium" ||
    analysis.confidence === "low"
      ? analysis.confidence
      : undefined;

  return (
    service !== undefined &&
    validServices.has(service) &&
    (analysis.amountUsd === null ||
      (typeof analysis.amountUsd === "number" &&
        Number.isFinite(analysis.amountUsd) &&
        analysis.amountUsd >= 0)) &&
    (analysis.billingPeriod === null ||
      typeof analysis.billingPeriod === "string") &&
    confidence !== undefined &&
    validConfidence.has(confidence)
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

    const imageBase64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 220,
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
                  { type: "string", enum: ["OpenAI", "Anthropic", "Other"] },
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
            "You extract current-period API usage totals ONLY from OpenAI Platform or Anthropic Console billing/usage screens.",
            "",
            "PROVIDER IDENTIFICATION (do this first; never skip):",
            "- Default assumption: the image is NOT a supported billing screen. Prefer service=Other or null unless evidence is clear.",
            "- Never choose OpenAI merely because this request uses an OpenAI model, the word API appears, or a dollar amount is visible.",
            "- OpenAI is allowed ONLY with explicit OpenAI Platform / API billing evidence, such as: platform.openai.com, usage.openai.com, openai.com/settings/organization, navigation like Usage / Billing / Limits / Cost, model-usage tables (gpt-4o, gpt-4.1, o-series), organization spend, or clear OpenAI Platform chrome.",
            "- Anthropic is allowed ONLY with explicit Anthropic Console evidence, such as: console.anthropic.com, Claude API console chrome, Workspaces / Usage / Billing / Cost, or Claude model usage tables (claude-*).",
            "- ChatGPT consumer product is NOT OpenAI Platform: chatgpt.com, ChatGPT Plus/Pro subscription, ChatGPT settings, mobile ChatGPT app, custom GPTs store, or ChatGPT memory settings → service=Other, amountUsd=null.",
            "- Also reject as Other/null: Midjourney, Cursor, GitHub Copilot, Google AI Studio/Gemini, Perplexity, Replicate, Hugging Face, Stripe receipts, bank/card statements, invoices, email receipts, Slack, Notion, random photos, memes, desktop wallpaper, and any non-billing UI.",
            "- If branding is mixed, cropped, blurred, or only a generic dollar amount is visible without provider chrome → service=Other or null, confidence=low, amountUsd=null.",
            "",
            "AMOUNT EXTRACTION (only after a supported provider is confirmed):",
            "- amountUsd must be the explicit current-period total spend / total usage / total cost tied to the selected billing period.",
            "- Ignore credits, prepaid balance, available balance, payment due, tax-only lines, plan subscription prices, projected/forecast spend, daily cost, and single model/line-item costs when a period total exists.",
            "- Never invent or sum line items. If the period total is missing or ambiguous → amountUsd=null and confidence=low.",
            "- Copy the visible billing period string into billingPeriod when present; otherwise null.",
            "- Accept USD only. Do not convert other currencies.",
            "",
            "CONFIDENCE:",
            "- high: provider identity and period total are unmistakable.",
            "- medium: provider is clear but layout is partially cropped or labels are slightly ambiguous.",
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
                "If it is not a clear OpenAI Platform or Anthropic Console usage/billing screen, return service=Other (or null), amountUsd=null, confidence=low.",
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

    const supportedService =
      parsed.service === "OpenAI" || parsed.service === "Anthropic"
        ? parsed.service
        : null;

    // Reject weak / unsupported classifications so non-billing photos never land on OpenAI.
    if (
      !supportedService ||
      parsed.amountUsd === null ||
      parsed.confidence === "low"
    ) {
      return NextResponse.json(
        {
          error:
            "This does not look like a clear OpenAI Platform or Anthropic Console billing screen. Enter the amount manually, or upload a usage/billing screenshot.",
          service: parsed.service,
          confidence: parsed.confidence,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      service: supportedService,
      amountUsd: Math.round(parsed.amountUsd * 100) / 100,
      billingPeriod: parsed.billingPeriod,
      confidence: parsed.confidence,
    });
  } catch (error) {
    console.error("[analyze-billing]", error);
    return NextResponse.json(
      { error: "The billing scanner could not analyze this image. Please try again." },
      { status: 502 },
    );
  }
}
