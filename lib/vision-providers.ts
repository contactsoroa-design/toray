/** Providers available to every signed-out / free user via Vision. */
export const FREE_VISION_PROVIDERS = ["OpenAI", "Anthropic"] as const;

/** Extra Vision providers unlocked for verified ToRay Pros. */
export const FOUNDING_VISION_PROVIDERS = [
  "Gemini",
  "Grok",
  "Cursor",
  "Copilot",
] as const;

export type VisionProvider =
  | (typeof FREE_VISION_PROVIDERS)[number]
  | (typeof FOUNDING_VISION_PROVIDERS)[number];

export function isVisionProvider(value: unknown): value is VisionProvider {
  return (
    value === "OpenAI" ||
    value === "Anthropic" ||
    value === "Gemini" ||
    value === "Grok" ||
    value === "Cursor" ||
    value === "Copilot"
  );
}

export function visionProviderToToolName(provider: VisionProvider): string {
  switch (provider) {
    case "OpenAI":
      return "OpenAI API";
    case "Anthropic":
      return "Anthropic API";
    case "Gemini":
      return "Gemini API";
    case "Grok":
      return "Grok";
    case "Cursor":
      return "Cursor Pro";
    case "Copilot":
      return "GitHub Copilot";
    default:
      return provider;
  }
}

export function foundingVisionUnlockLabel(provider: VisionProvider): string {
  switch (provider) {
    case "Gemini":
      return "Gemini API";
    case "Grok":
      return "Grok";
    case "Cursor":
      return "Cursor Pro";
    case "Copilot":
      return "GitHub Copilot";
    default:
      return visionProviderToToolName(provider);
  }
}
