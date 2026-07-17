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
      max_tokens: 200,
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
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Analyze this AI-provider billing or usage screenshot.",
                "Identify the provider as OpenAI, Anthropic, Other, or null.",
                "Extract only the current billing period's total usage amount in USD.",
                "Do not sum separate model line items when an explicit total is visible.",
                "Do not convert non-USD amounts and never guess.",
                "Use null for values you cannot read confidently.",
                "Return the billing period exactly as visible when present.",
              ].join("\n"),
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
    if (!isBillingAnalysis(parsed) || parsed.amountUsd === null) {
      return NextResponse.json(
        { error: "We could not find a clear USD billing total in this screenshot." },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ...parsed,
      amountUsd: Math.round(parsed.amountUsd * 100) / 100,
    });
  } catch (error) {
    console.error("[analyze-billing]", error);
    return NextResponse.json(
      { error: "The billing scanner could not analyze this image. Please try again." },
      { status: 502 },
    );
  }
}
