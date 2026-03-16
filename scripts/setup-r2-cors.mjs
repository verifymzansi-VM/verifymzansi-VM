#!/usr/bin/env node
/**
 * Configure CORS on the verifymzansi-public R2 bucket.
 *
 * Required for direct browser → R2 video uploads via presigned PUT URLs.
 * Run once:  node scripts/setup-r2-cors.mjs
 *
 * Reads R2 credentials from .env.local (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET).
 */

import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Load env from .env.local ─────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return vars;
}

const env = loadEnv();
const accountId = env.R2_ACCOUNT_ID;
const accessKeyId = env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
const bucket = env.R2_PUBLIC_BUCKET || "verifymzansi-public";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2 credentials in .env.local");
  process.exit(1);
}

// ── Apply CORS ───────────────────────────────────────────────────────────
const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const corsRules = [
  {
    AllowedOrigins: ["https://verifymzansi.com"],
    AllowedMethods: ["PUT"],
    AllowedHeaders: ["Content-Type"],
    MaxAgeSeconds: 3600,
  },
];

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: corsRules },
    })
  );
  console.log(`✓ CORS rules applied to "${bucket}"`);
  console.log("  AllowedOrigins:", corsRules[0].AllowedOrigins);
  console.log("  AllowedMethods:", corsRules[0].AllowedMethods);
  console.log("  AllowedHeaders:", corsRules[0].AllowedHeaders);
  console.log("  MaxAgeSeconds:", corsRules[0].MaxAgeSeconds);
} catch (err) {
  console.error("Failed to apply CORS rules:", err.message);
  process.exit(1);
}
