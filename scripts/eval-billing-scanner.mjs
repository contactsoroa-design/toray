#!/usr/bin/env node
/**
 * Evaluate /api/analyze-billing against the golden fixture set.
 *
 * Usage:
 *   1. npm run dev
 *   2. npm run test:billing
 *
 * Optional:
 *   BILLING_EVAL_BASE_URL=https://toray.vercel.app npm run test:billing
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
    const ok =
      response.status === 200 &&
      body.service === expect.service &&
      typeof body.amountUsd === "number" &&
      amountClose(body.amountUsd, expect.amountUsd, expect.amountTolerance ?? 0.05) &&
      (expect.allowedConfidence ?? ["high", "medium"]).includes(body.confidence);

    return {
      id: testCase.id,
      ok,
      ms,
      detail: ok
        ? `${body.service} $${body.amountUsd} (${body.confidence})`
        : `expected ${expect.service} ~$${expect.amountUsd}, got status=${response.status} ${JSON.stringify(body)}`,
    };
  }

  const rejected =
    response.status >= 400 &&
    body.service !== "OpenAI" &&
    body.service !== "Anthropic";

  // Also treat 422 with an error and no accepted service as success,
  // even if the model briefly guessed OpenAI but the API rejected low confidence.
  const apiRejectedUnsupported =
    response.status === 422 &&
    typeof body.error === "string" &&
    body.amountUsd == null;

  const ok = rejected || apiRejectedUnsupported;

  return {
    id: testCase.id,
    ok,
    ms,
    detail: ok
      ? `rejected status=${response.status} service=${body.service ?? "n/a"}`
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
