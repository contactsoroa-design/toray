#!/usr/bin/env node
/**
 * Evaluate /api/analyze-billing against the golden fixture set.
 *
 * Usage:
 *   1. npm run dev
 *   2. BILLING_EVAL_ALLOW_FOUNDING=1 npm run test:billing
 *
 * Optional:
 *   BILLING_EVAL_BASE_URL=https://toray.vercel.app npm run test:billing
 *
 * Note: Pro-only providers need BILLING_EVAL_ALLOW_FOUNDING=1 on a non-production
 * server (set in the Next.js process env, not only the eval client).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldenDir = join(root, "test/billing-golden");
const manifest = JSON.parse(
  readFileSync(join(goldenDir, "manifest.json"), "utf8"),
);

const baseUrl = (
  process.env[manifest.baseUrlEnv] ||
  process.env.BILLING_EVAL_BASE_URL ||
  manifest.defaultBaseUrl
).replace(/\/$/, "");

const endpoint = `${baseUrl}/api/analyze-billing`;

function amountClose(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}

function isAcceptedBody(body, expect) {
  return (
    body.service === expect.service &&
    typeof body.amountUsd === "number" &&
    amountClose(body.amountUsd, expect.amountUsd, expect.amountTolerance ?? 0.05) &&
    (expect.allowedConfidence ?? ["high", "medium"]).includes(body.confidence)
  );
}

async function runCase(testCase) {
  const imagePath = join(goldenDir, testCase.file);
  const bytes = readFileSync(imagePath);
  const form = new FormData();
  form.append(
    "image",
    new Blob([bytes], { type: "image/png" }),
    testCase.file.split("/").pop(),
  );

  const started = Date.now();
  const response = await fetch(endpoint, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  const ms = Date.now() - started;
  const expect = testCase.expect;

  if (expect.accept) {
    if (expect.requiresFounding && response.status === 402) {
      // Server without founding bypass still proves classification + OCR.
      const ok =
        body.code === "FOUNDING_REQUIRED" &&
        body.service === expect.service &&
        typeof body.amountUsd === "number" &&
        amountClose(
          body.amountUsd,
          expect.amountUsd,
          expect.amountTolerance ?? 0.05,
        );
      return {
        id: testCase.id,
        ok,
        ms,
        detail: ok
          ? `classified ${body.service} $${body.amountUsd} (402 founding gate)`
          : `expected founding gate for ${expect.service} ~$${expect.amountUsd}, got status=${response.status} ${JSON.stringify(body)}`,
      };
    }

    const ok = response.status === 200 && isAcceptedBody(body, expect);
    return {
      id: testCase.id,
      ok,
      ms,
      detail: ok
        ? `${body.service} $${body.amountUsd} (${body.confidence})`
        : `expected ${expect.service} ~$${expect.amountUsd}, got status=${response.status} ${JSON.stringify(body)}`,
    };
  }

  const rejectedUnsupported =
    response.status >= 400 &&
    body.service !== "OpenAI" &&
    body.service !== "Anthropic";

  const apiRejectedUnsupported =
    response.status === 422 &&
    typeof body.error === "string" &&
    (body.amountUsd == null ||
      body.reason === "non_usd" ||
      body.reason === "not_period_total" ||
      body.reason === "low_confidence" ||
      body.reason === "unsupported_service");

  // Accept reject even if model briefly labeled OpenAI but currency/kind failed.
  const hardGateReject =
    response.status === 422 &&
    (body.reason === "non_usd" ||
      body.reason === "not_period_total" ||
      body.reason === "missing_amount" ||
      body.reason === "low_confidence");

  const ok = rejectedUnsupported || apiRejectedUnsupported || hardGateReject;

  return {
    id: testCase.id,
    ok,
    ms,
    detail: ok
      ? `rejected status=${response.status} service=${body.service ?? "n/a"} reason=${body.reason ?? "n/a"}`
      : `expected reject, got status=${response.status} ${JSON.stringify(body)}`,
  };
}

async function main() {
  console.log(`Evaluating ${manifest.cases.length} cases against ${endpoint}\n`);

  const results = [];
  for (const testCase of manifest.cases) {
    process.stdout.write(`• ${testCase.id} ... `);
    try {
      const result = await runCase(testCase);
      results.push(result);
      console.log(`${result.ok ? "PASS" : "FAIL"} (${result.ms}ms) ${result.detail}`);
    } catch (error) {
      const result = {
        id: testCase.id,
        ok: false,
        ms: 0,
        detail: error instanceof Error ? error.message : String(error),
      };
      results.push(result);
      console.log(`FAIL ${result.detail}`);
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${passed}/${results.length} passed${failed ? `, ${failed} failed` : ""}`);

  if (failed > 0) process.exit(1);
}

main();
