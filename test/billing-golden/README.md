# Billing scanner golden set

Synthetic fixtures + a local eval harness for `/api/analyze-billing`.

This is **not model training**. It is a regression suite so we can catch:

- false positives (ChatGPT / photos / other SaaS marked as OpenAI)
- false negatives (real Platform / Console totals rejected)
- amount drift on known totals
- non-USD / credits-only false accepts
- Pro Vision providers (Gemini, Grok, Cursor, Copilot)

## Quick start

```bash
# regenerate synthetic PNGs
npm run test:billing:fixtures

# with the Next.js app running locally
npm run dev

# in another terminal — founding bypass lets Pro fixtures return 200
BILLING_EVAL_ALLOW_FOUNDING=1 npm run dev
# or keep normal dev and accept 402 founding-gate passes for Pro cases:
npm run test:billing
```

Against production (Pro cases pass via 402 + amount when not logged in as Pro):

```bash
BILLING_EVAL_BASE_URL=https://toray.vercel.app npm run test:billing
```

`BILLING_EVAL_ALLOW_FOUNDING=1` only works when `NODE_ENV !== "production"`.

## Adding real screenshots

1. Capture your own supported billing screen (or a known bad case).
2. Put the PNG/JPEG in `fixtures/real/` (gitignored — may contain org/spend data).
3. Add a case to `manifest.json`.

For Pro-only providers, set `"requiresFounding": true` in `expect`.

Do **not** commit real billing screenshots with account data.
