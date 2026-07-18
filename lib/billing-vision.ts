import type OpenAI from "openai";
import {
  FOUNDING_VISION_PROVIDERS,
  FREE_VISION_PROVIDERS,
  type VisionProvider,
} from "@/lib/vision-providers";

export const VISION_SERVICE_ENUM = [
  ...FREE_VISION_PROVIDERS,
  ...FOUNDING_VISION_PROVIDERS,
  "Other",
] as const;

export type VisionServiceLabel = (typeof VISION_SERVICE_ENUM)[number];

export type CurrencyCode = "USD" | "JPY" | "EUR" | "GBP" | "OTHER";
export type AmountKind =
  | "period_total"
  | "plan_price"
  | "credit_balance"
  | "line_item"
  | "other";

export type BillingVisionAnalysis = {
  service: VisionServiceLabel | null;
  amountUsd: number | null;
  billingPeriod: string | null;
  confidence: "high" | "medium" | "low";
  currencyCode: CurrencyCode | null;
  amountKind: AmountKind | null;
};

export const BILLING_VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    service: {
      anyOf: [
        { type: "string", enum: [...VISION_SERVICE_ENUM] },
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
    currencyCode: {
      anyOf: [
        {
          type: "string",
          enum: ["USD", "JPY", "EUR", "GBP", "OTHER"],
        },
        { type: "null" },
      ],
    },
    amountKind: {
      anyOf: [
        {
          type: "string",
          enum: [
            "period_total",
            "plan_price",
            "credit_balance",
            "line_item",
            "other",
          ],
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "service",
    "amountUsd",
    "billingPeriod",
    "confidence",
    "currencyCode",
    "amountKind",
  ],
} as const;

const SUPPORTED_LIST = [
  ...FREE_VISION_PROVIDERS,
  ...FOUNDING_VISION_PROVIDERS,
].join(", ");

export function billingVisionSystemPrompt(): string {
  return [
    "You are ToRay's strict billing-screenshot classifier and OCR engine.",
    "Extract current-period usage/billing totals from supported cloud consoles only.",
    "",
    "PROVIDER IDENTIFICATION (do this first; never skip):",
    "- Default assumption: the image is NOT a supported billing screen. Prefer service=Other or null unless evidence is clear.",
    "- OpenAI: ONLY OpenAI Platform / API billing (platform.openai.com, usage.openai.com, org Usage/Billing/Cost). Look for labels like “Total spend”, “Usage costs”, period selector. ChatGPT consumer (chatgpt.com, Plus/Pro settings) → Other.",
    "- Anthropic: ONLY Anthropic Console / Claude API (console.anthropic.com). Look for Workspaces Usage/Billing/Cost and “Total Spend” / “Cost”. Claude.ai consumer subscription → Other.",
    "- Gemini: ONLY Google AI Studio / Gemini API billing (aistudio.google.com) or clear Gemini API cost tables. Look for “Usage”, “Billing”, API cost totals. Consumer Gemini / Google One app alone → Other.",
    "- Grok: ONLY xAI API console billing/usage (console.x.ai). Look for xAI branding + API usage/cost. Consumer grok.x.ai chat subscription alone → Other.",
    "- Cursor: ONLY Cursor IDE/app billing or usage (cursor.com settings/billing, usage dashboard, invoice for Cursor Pro/Business usage). Look for Cursor wordmark + usage/$ spend for the period. Generic Stripe receipt without Cursor chrome → Other.",
    "- Copilot: ONLY GitHub Copilot billing/usage (github.com settings → Copilot/Billing, or Copilot usage meters). Look for GitHub + Copilot. Other GitHub invoices alone → Other.",
    "- Reject as Other/null: Midjourney, Perplexity, Replicate, Hugging Face, Azure portal without clear OpenAI/Anthropic, AWS generic bills, Stripe receipts, bank statements, email receipts, random photos.",
    "- If branding is mixed, cropped, blurred, or only a generic dollar amount is visible → service=Other or null, confidence=low, amountUsd=null.",
    "",
    "AMOUNT EXTRACTION (only after a supported provider is confirmed):",
    "- amountUsd = the explicit current-period total spend / total usage cost (not a forecast).",
    "- amountKind must be period_total for accepted totals. Use plan_price for $20/mo style plan cards, credit_balance for credits remaining, line_item for a single model row when a period total exists elsewhere, other otherwise.",
    "- currencyCode: USD if $ / USD is explicit; JPY for ¥/円; EUR for €; GBP for £; OTHER if unclear or mixed. Never convert currencies.",
    "- Ignore credits, prepaid balance, payment due, tax-only lines, plan prices, projected spend, and line-items when a period total exists.",
    "- Never invent or sum line items. If the period total is missing → amountUsd=null, amountKind=null or other, confidence=low.",
    "- Copy the visible billing period into billingPeriod when present; otherwise null.",
    "- amountUsd must be the numeric USD amount only (e.g. 142.50). Do not include currency symbols.",
    "",
    "CONFIDENCE:",
    "- high: provider identity, USD, and period total are unmistakable.",
    "- medium: provider is clear but layout is partially cropped or labels are slightly ambiguous.",
    "- low: provider, currency, or total is uncertain. If low, set service to Other or null and amountUsd to null.",
    "",
    "Return only JSON matching the schema.",
  ].join("\n");
}

export function billingVisionUserPrompt(): string {
  return [
    "Classify this screenshot first.",
    `If it is not a clear supported billing/usage console, return service=Other (or null), amountUsd=null, confidence=low, currencyCode=null, amountKind=null.`,
    `Supported providers: ${SUPPORTED_LIST}.`,
    "Only if the provider is clearly supported, extract the current-period USD total with currencyCode=USD and amountKind=period_total.",
  ].join(" ");
}

export function isBillingVisionAnalysis(
  value: unknown,
): value is BillingVisionAnalysis {
  if (!value || typeof value !== "object") return false;

  const analysis = value as Record<string, unknown>;
  const validServices = new Set<unknown>([...VISION_SERVICE_ENUM, null]);
  const service = validServices.has(analysis.service)
    ? (analysis.service as BillingVisionAnalysis["service"])
    : undefined;

  const confidence =
    analysis.confidence === "high" ||
    analysis.confidence === "medium" ||
    analysis.confidence === "low"
      ? analysis.confidence
      : undefined;

  const currencyOk =
    analysis.currencyCode === null ||
    analysis.currencyCode === "USD" ||
    analysis.currencyCode === "JPY" ||
    analysis.currencyCode === "EUR" ||
    analysis.currencyCode === "GBP" ||
    analysis.currencyCode === "OTHER";

  const amountKindOk =
    analysis.amountKind === null ||
    analysis.amountKind === "period_total" ||
    analysis.amountKind === "plan_price" ||
    analysis.amountKind === "credit_balance" ||
    analysis.amountKind === "line_item" ||
    analysis.amountKind === "other";

  return (
    service !== undefined &&
    (analysis.amountUsd === null ||
      (typeof analysis.amountUsd === "number" &&
        Number.isFinite(analysis.amountUsd) &&
        analysis.amountUsd >= 0)) &&
    (analysis.billingPeriod === null ||
      typeof analysis.billingPeriod === "string") &&
    confidence !== undefined &&
    currencyOk &&
    amountKindOk
  );
}

/** Hard post-OCR gates beyond model confidence. */
export function billingVisionRejectReason(
  analysis: BillingVisionAnalysis,
): string | null {
  if (analysis.confidence === "low") {
    return "low_confidence";
  }
  if (analysis.service === null || analysis.service === "Other") {
    return "unsupported_service";
  }
  if (analysis.amountUsd === null) {
    return "missing_amount";
  }
  if (analysis.currencyCode !== "USD") {
    return "non_usd";
  }
  if (analysis.amountKind !== "period_total") {
    return "not_period_total";
  }
  // Sanity: reject absurd OCR hallucinations
  if (analysis.amountUsd > 1_000_000) {
    return "amount_too_large";
  }
  return null;
}

export function shouldEscalateVisionModel(
  analysis: BillingVisionAnalysis,
): boolean {
  // Clear rejects — don't spend a second model call.
  if (analysis.confidence === "low") return false;
  if (analysis.service === null || analysis.service === "Other") return false;

  if (analysis.confidence === "medium") return true;
  if (analysis.currencyCode == null || analysis.amountKind == null) return true;
  if (
    analysis.amountUsd != null &&
    analysis.currencyCode !== "USD"
  ) {
    // Give stronger model a chance before hard-rejecting currency
    return true;
  }
  if (
    analysis.amountUsd != null &&
    analysis.amountKind !== "period_total"
  ) {
    return true;
  }
  return false;
}

export async function runBillingVisionCompletion(
  openai: OpenAI,
  params: {
    model: string;
    imageType: string;
    imageBase64: string;
    maxTokens?: number;
  },
) {
  return openai.chat.completions.create({
    model: params.model,
    temperature: 0,
    max_tokens: params.maxTokens ?? 360,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "billing_analysis",
        strict: true,
        // OpenAI JSON schema typing is stricter than our const object.
        schema: BILLING_VISION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [
      {
        role: "system",
        content: billingVisionSystemPrompt(),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: billingVisionUserPrompt(),
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${params.imageType};base64,${params.imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
  });
}

export function isFoundingVisionProvider(
  provider: VisionProvider | string,
): boolean {
  return (FOUNDING_VISION_PROVIDERS as readonly string[]).includes(provider);
}

export function isFreeVisionProvider(
  provider: VisionProvider | string,
): boolean {
  return (FREE_VISION_PROVIDERS as readonly string[]).includes(provider);
}
