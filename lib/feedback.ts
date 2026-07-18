export const FEEDBACK_CATEGORIES = [
  "bug",
  "idea",
  "confusing",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CONTEXTS = [
  "header",
  "footer",
  "scan_error",
  "tool_limit",
  "founding_cta",
  "sign_in",
  "budget_cap",
  "outlook",
] as const;

export type FeedbackContext = (typeof FEEDBACK_CONTEXTS)[number];

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Something broken",
  idea: "Feature idea",
  confusing: "Confusing",
  other: "Other",
};

export const FEEDBACK_CONTEXT_PROMPTS: Record<FeedbackContext, string> = {
  header: "What’s on your mind?",
  footer: "What’s on your mind?",
  scan_error: "What went wrong with the scan?",
  tool_limit: "What tool or limit is blocking you?",
  founding_cta: "What’s stopping you from upgrading — or what would make Pro worth it?",
  sign_in: "What went wrong with sign-in?",
  budget_cap: "Is the $400 free budget too low — or something else?",
  outlook: "What do you need from month-end outlook?",
};

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return (
    typeof value === "string" &&
    (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isFeedbackContext(value: unknown): value is FeedbackContext {
  return (
    typeof value === "string" &&
    (FEEDBACK_CONTEXTS as readonly string[]).includes(value)
  );
}
