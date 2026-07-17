# Billing scanner golden set

Synthetic fixtures + a local eval harness for `/api/analyze-billing`.

This is **not model training**. It is a regression suite so we can catch:

- false positives (ChatGPT / photos / other SaaS marked as OpenAI)
- false negatives (real Platform / Console totals rejected)
- amount drift on known totals

## Quick start

```bash
# regenerate synthetic PNGs (optional; committed fixtures already exist after first run)
npm run test:billing:fixtures

# with the Next.js app running locally
npm run dev
npm run test:billing
```

Against production:

```bash
BILLING_EVAL_BASE_URL=https://toray.vercel.app npm run test:billing
```

## Adding real screenshots

1. Capture your own OpenAI Platform or Anthropic Console billing screen (or a known bad case).
2. Put the PNG/JPEG in `fixtures/real/` (gitignored — may contain org/spend data).
3. Add a case to `manifest.json`, for example:

```json
{
  "id": "real-openai-jul",
  "file": "fixtures/real/openai-jul.png",
  "expect": {
    "accept": true,
    "service": "OpenAI",
    "amountUsd": 142.5,
    "amountTolerance": 0.5,
    "allowedConfidence": ["high", "medium"]
  }
}
```

For negatives, use `"expect": { "accept": false }`.

Do **not** commit real billing screenshots with account data.
