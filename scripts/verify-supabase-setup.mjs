#!/usr/bin/env node
/**
 * Checklist verifier — prints pass/fail only (never prints secrets).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.local");

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    env[trimmed.slice(0, i)] = trimmed.slice(i + 1);
  }
  return env;
}

const env = loadEnv(envPath);
const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const site = env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");

const results = [];

function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

pass("NEXT_PUBLIC_SUPABASE_URL set", Boolean(url && url.startsWith("https://")));
pass("NEXT_PUBLIC_SUPABASE_ANON_KEY set", Boolean(anon && anon.length > 20));
pass(
  "NEXT_PUBLIC_SITE_URL set",
  Boolean(site && /^https?:\/\//.test(site)),
  site ? "present" : "missing",
);

if (!url || !anon) {
  console.log("\nStopped: missing Supabase env.");
  process.exit(1);
}

const headers = {
  apikey: anon,
  Authorization: `Bearer ${anon}`,
};

const healthRes = await fetch(`${url}/auth/v1/health`, { headers });
pass("Auth API reachable", healthRes.ok, `HTTP ${healthRes.status}`);

const tableRes = await fetch(`${url}/rest/v1/billing_scans?select=id&limit=1`, {
  headers,
});
const tableBody = await tableRes.text();
let tableOk = false;
let tableDetail = `HTTP ${tableRes.status}`;

if (tableRes.status === 200) {
  tableOk = true;
  tableDetail = "table exists (RLS may return empty until logged in)";
} else if (
  tableBody.includes("Could not find the table") ||
  tableBody.includes("PGRST205") ||
  tableBody.includes("schema cache")
) {
  tableOk = false;
  tableDetail = "table not found — run the migration SQL";
} else if (tableRes.status === 401 || tableRes.status === 403) {
  // Table may exist but be locked down; treat as partial signal
  tableOk = true;
  tableDetail = `HTTP ${tableRes.status} (likely exists; RLS/grants blocking anon)`;
} else {
  tableDetail = `HTTP ${tableRes.status}: ${tableBody.slice(0, 120)}`;
}

pass("billing_scans table", tableOk, tableDetail);

console.log("\nManual check still required in Dashboard:");
console.log(
  "  Authentication → URL Configuration → Redirect URLs includes:",
);
console.log(`    ${site || "http://localhost:3000"}/auth/callback`);
console.log("    https://toray.vercel.app/auth/callback");

const failed = results.filter((r) => !r.ok).length;
process.exit(failed ? 1 : 0);
