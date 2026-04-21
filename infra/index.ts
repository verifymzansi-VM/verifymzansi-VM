/**
 * VerifyMzansi — Infrastructure as Code (Pulumi + Cloudflare)
 *
 * Manages:
 *  - Cloudflare Pages project
 *  - R2 bucket (media storage)
 *  - Workers (KYC encryptor, rate limiter, retention cleanup)
 *  - DNS records
 *  - Secrets
 *
 * Usage:
 *   cd infra && pulumi up
 *   pulumi preview  — dry-run
 *   pulumi destroy  — tear down
 */

import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";

const config = new pulumi.Config();
const accountId = config.require("cloudflareAccountId");
const _zoneName = config.get("zoneName") ?? "verifymzansi.com";

// ── R2 Bucket — media storage ──────────────────────────
export const mediaBucket = new cloudflare.R2Bucket("verifymzansi-media", {
  accountId,
  name: "verifymzansi-media",
});

// NOTE: browser direct uploads to the public bucket depend on an account-level
// R2 bucket CORS policy that currently sits outside this Pulumi program.
// Keep the bucket policy aligned with the public app origins configured in
// wrangler.toml / NEXT_PUBLIC_APP_URL, including:
//   - https://verifymzansi.com
//   - https://www.verifymzansi.com
//   - https://staging.verifymzansi.com
// If these origins drift out of sync, presigned browser PUT uploads can fail
// on the media/review step even while server-side photo uploads continue to work.

// ── R2 Bucket — KYC evidence (private, encrypted at rest) ─
export const kycBucket = new cloudflare.R2Bucket("verifymzansi-kyc", {
  accountId,
  name: "verifymzansi-kyc",
});

// ── Workers ──────────────────────────────────────────────

// KYC Encryptor Worker
export const kycEncryptorWorker = new cloudflare.WorkerScript("kyc-encryptor", {
  accountId,
  name: "kyc-encryptor",
  content: "/* deployed via wrangler — see wrangler.kyc-encryptor.toml */",
  module: true,
});

// Rate Limiter Worker
export const rateLimiterWorker = new cloudflare.WorkerScript("rate-limiter", {
  accountId,
  name: "rate-limiter",
  content: "/* deployed via wrangler — see wrangler.rate-limiter.toml */",
  module: true,
});

// Retention Cleanup Worker
export const retentionCleanupWorker = new cloudflare.WorkerScript("retention-cleanup", {
  accountId,
  name: "retention-cleanup",
  content: "/* deployed via wrangler — see wrangler.retention-cleanup.toml */",
  module: true,
});

// ── Outputs ─────────────────────────────────────────────
export const outputs = {
  mediaBucketName: mediaBucket.name,
  kycBucketName: kycBucket.name,
};
