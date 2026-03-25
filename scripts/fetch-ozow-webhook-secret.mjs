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
import crypto from "crypto";

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
const args = process.argv.slice(2);

function redact(value, visible = 4) {
  if (!value) return "[not set]";
  if (value.length <= visible) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(4, value.length - visible))}${value.slice(-visible)}`;
}

function getArg(name) {
  const valuePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(valuePrefix));
  if (inline) return inline.slice(valuePrefix.length).trim();

  const idx = args.findIndex((arg) => arg === name);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1].trim();
  return "";
}

function getWebhookItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  return payload ? [payload] : [];
}

const clientId = get("OZOW_CLIENT_ID");
const clientSecret = get("OZOW_CLIENT_SECRET");
const ozowEnv = get("OZOW_ENV") || "staging";
const oauthScope = get("OZOW_WEBHOOK_OAUTH_SCOPE") || "webhooks";
const requestedWebhookId =
  getArg("--webhook-id") || getArg("-w") || get("OZOW_WEBHOOK_ID") || "";

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
console.log(`Client ID:   ${redact(clientId)}`);
console.log(`Scope:       ${oauthScope}`);
if (requestedWebhookId) {
  console.log(`Webhook ID:  ${requestedWebhookId}`);
}
console.log();

function buildHeaders(token) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-Correlation-ID": crypto.randomUUID(),
  };
}

async function parseErrorResponse(response) {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw);
    return {
      raw,
      message: parsed?.detail || parsed?.title || parsed?.message || raw,
      requestId: parsed?.id || null,
    };
  } catch {
    return { raw, message: raw, requestId: null };
  }
}

// ── Step 1: Get OAuth token ──────────────────────────────────────
console.log("1. Requesting OAuth token...");
const tokenRes = await fetch(`${baseUrl}/v1/token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "X-Correlation-ID": crypto.randomUUID(),
  },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: oauthScope,
  }),
});

if (!tokenRes.ok) {
  const error = await parseErrorResponse(tokenRes);
  console.error(`Token request failed (${tokenRes.status}): ${error.message}`);
  if (error.requestId) {
    console.error(`Ozow request id: ${error.requestId}`);
  }
  process.exit(1);
}

const tokenData = await tokenRes.json();
const accessToken = tokenData.access_token || tokenData.token;
console.log(`   Token obtained (expires in ${tokenData.expires_in || "?"}s)\n`);

// ── Step 2: List webhooks ────────────────────────────────────────
let webhookIds = [];

if (requestedWebhookId) {
  webhookIds = [requestedWebhookId];
} else {
  console.log("2. Listing webhook subscriptions...");
  const webhooksRes = await fetch(`${baseUrl}/v1/webhooks`, {
    headers: buildHeaders(accessToken),
  });

  if (!webhooksRes.ok) {
    const error = await parseErrorResponse(webhooksRes);
    console.error(`List webhooks failed (${webhooksRes.status}): ${error.message}`);
    if (error.requestId) {
      console.error(`Ozow request id: ${error.requestId}`);
    }
    process.exit(1);
  }

  const webhooks = await webhooksRes.json();
  const items = getWebhookItems(webhooks);
  webhookIds = items.map((wh) => wh?.id).filter(Boolean);

  console.log(`   Found ${webhookIds.length} webhook(s)`);
  for (const wh of items) {
    if (!wh?.id) continue;
    console.log(
      `   - ID: ${wh.id}  URL: ${wh.endpoint || wh.url || wh.callbackUrl || "?"}`
    );
  }
  console.log();
}

if (webhookIds.length === 0) {
  console.error("No webhook subscriptions found. Create one in Ozow, then re-run this script.");
  process.exit(1);
}

for (const webhookId of webhookIds) {
  console.log(`3. Fetching secret for webhook ${webhookId}...`);
  const secretRes = await fetch(`${baseUrl}/v1/webhooks/${webhookId}/secret`, {
    headers: buildHeaders(accessToken),
  });

  if (!secretRes.ok) {
    const error = await parseErrorResponse(secretRes);
    console.error(`   Secret request failed (${secretRes.status}): ${error.message}`);
    if (error.requestId) {
      console.error(`   Ozow request id: ${error.requestId}`);
    }
    continue;
  }

  const secretData = await secretRes.json();
  const secret = typeof secretData?.secret === "string" ? secretData.secret : "";
  if (!secret) {
    console.error("   Secret response did not include a usable secret value.");
    continue;
  }

  console.log("   Secret retrieved successfully.");
  console.log();
  console.log("   Update OZOW_WEBHOOK_SECRET in your local env and secret store.");
  console.log("   Cloudflare command: pnpm wrangler secret put OZOW_WEBHOOK_SECRET");
}
