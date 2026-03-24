#!/usr/bin/env node
/**
 * Fetches the Ozow One API webhook secret.
 *
 * Usage:
 *   node scripts/fetch-ozow-webhook-secret.mjs
 *
 * Reads OZOW_CLIENT_ID, OZOW_CLIENT_SECRET, and OZOW_ENV from .env.local
 * (or pass them as environment variables).
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Load .env.local ──────────────────────────────────────────────
function loadEnv() {
  const envVars = {};
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      envVars[key] = val;
    }
  } catch {
    // ignore — env vars should come from process.env
  }
  return envVars;
}

const dotenv = loadEnv();
const get = (key) => process.env[key] || dotenv[key];

const clientId = get("OZOW_CLIENT_ID");
const clientSecret = get("OZOW_CLIENT_SECRET");
const ozowEnv = get("OZOW_ENV") || "staging";

if (!clientId || !clientSecret) {
  console.error("ERROR: OZOW_CLIENT_ID and OZOW_CLIENT_SECRET must be set.");
  process.exit(1);
}

const baseUrl =
  ozowEnv === "production"
    ? "https://one.ozow.com"
    : "https://stagingone.ozow.com";

console.log(`Environment: ${ozowEnv}`);
console.log(`Base URL:    ${baseUrl}`);
console.log(`Client ID:   ${clientId}`);
console.log();

// ── Step 1: Get OAuth token ──────────────────────────────────────
console.log("1. Requesting OAuth token...");
const tokenRes = await fetch(`${baseUrl}/v1/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }),
});

if (!tokenRes.ok) {
  const body = await tokenRes.text();
  console.error(`Token request failed (${tokenRes.status}): ${body}`);
  process.exit(1);
}

const tokenData = await tokenRes.json();
const accessToken = tokenData.access_token || tokenData.token;
console.log(`   Token obtained (expires in ${tokenData.expires_in || "?"}s)\n`);

// ── Step 2: List webhooks ────────────────────────────────────────
console.log("2. Listing webhook subscriptions...");
const webhooksRes = await fetch(`${baseUrl}/v1/webhooks`, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  },
});

if (!webhooksRes.ok) {
  const body = await webhooksRes.text();
  console.error(`List webhooks failed (${webhooksRes.status}): ${body}`);
  process.exit(1);
}

const webhooks = await webhooksRes.json();
console.log(`   Found ${Array.isArray(webhooks) ? webhooks.length : "?"} webhook(s)`);

const items = Array.isArray(webhooks) ? webhooks : webhooks.data || webhooks.items || [webhooks];
for (const wh of items) {
  console.log(`   - ID: ${wh.id}  URL: ${wh.url || wh.callbackUrl || "?"}`);
}
console.log();

// ── Step 3: Get secret for each webhook ──────────────────────────
for (const wh of items) {
  if (!wh.id) continue;
  console.log(`3. Fetching secret for webhook ${wh.id}...`);
  const secretRes = await fetch(`${baseUrl}/v1/webhooks/${wh.id}/secret`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!secretRes.ok) {
    const body = await secretRes.text();
    console.error(`   Secret request failed (${secretRes.status}): ${body}`);
    continue;
  }

  const secretData = await secretRes.json();
  console.log(`   ✓ WEBHOOK SECRET: ${secretData.secret}`);
  console.log();
  console.log("   Add this to your .env.local:");
  console.log(`   OZOW_WEBHOOK_SECRET=${secretData.secret}`);
  console.log();
  console.log("   And for Cloudflare production:");
  console.log(`   pnpm wrangler secret put OZOW_WEBHOOK_SECRET`);
}
