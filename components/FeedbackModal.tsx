"use client";

import { useState, type FormEvent } from "react";
import { MessageSquareText, X } from "lucide-react";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_CONTEXT_PROMPTS,
  type FeedbackCategory,
  type FeedbackContext,
} from "@/lib/feedback";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-sage-soft">
      {children}
    </p>
  );
}

export function FeedbackModal({
  context,
  isLoggedIn,
  defaultEmail,
  onClose,
}: {
  context: FeedbackContext;
  isLoggedIn: boolean;
  defaultEmail: string | null;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("confusing");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          category,
          context,
          email: isLoggedIn ? undefined : email || undefined,
          company: honeypot,
          path: window.location.pathname,
          userAgent: navigator.userAgent,
        }),
      });
      const result = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not send feedback.");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-5 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-title"
    >
      <form
        noValidate
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-[28px] border border-hairline bg-surface p-6 shadow-2xl md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow>Feedback</Eyebrow>
            <h2
              id="feedback-title"
              className="mt-2 font-serif text-2xl tracking-[-0.02em] text-bone"
            >
              Help shape ToRay
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-bone-muted">
              {FEEDBACK_CONTEXT_PROMPTS[context]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-bone-muted transition hover:bg-bone/10 hover:text-bone"
            aria-label="Close feedback"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="mt-6 rounded-2xl border border-mint/30 bg-mint/10 px-4 py-4">
            <p className="font-medium text-mint">Thanks — that helps.</p>
            <p className="mt-1 text-sm text-bone-muted">
              We read every note with context (where you were, Free vs Pro).
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <fieldset className="mt-5">
              <legend className="text-sm text-bone-muted">Category</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FEEDBACK_CATEGORIES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCategory(value)}
                    className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                      category === value
                        ? "bg-sage text-bone"
                        : "border border-hairline text-bone-muted hover:text-bone"
                    }`}
                  >
                    {FEEDBACK_CATEGORY_LABELS[value]}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="mt-5 grid gap-1.5 text-sm text-bone-muted">
              Your note
              <textarea
                required
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="One concrete sentence is enough…"
                className="resize-none rounded-2xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition placeholder:text-bone-muted/50 focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
              />
            </label>

            {!isLoggedIn && (
              <label className="mt-4 grid gap-1.5 text-sm text-bone-muted">
                Email <span className="text-bone-muted/60">(optional)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-bone outline-none transition placeholder:text-bone-muted/50 focus:border-sage-soft/60 focus:ring-2 focus:ring-sage/20"
                />
              </label>
            )}

            {/* Honeypot */}
            <label className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
              Company
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </label>

            {error && <p className="mt-3 text-sm text-warning">{error}</p>}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-hairline px-4 py-2 text-sm text-bone-muted transition hover:text-bone"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !message.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-medium text-bone transition hover:bg-sage-glow disabled:cursor-wait disabled:opacity-60"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                {submitting ? "Sending…" : "Send feedback"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
