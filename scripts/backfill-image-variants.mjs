#!/usr/bin/env node
/**
 * Backfill responsive image variants for existing R2 media.
 *
 * Cloudflare Image Resizing is not enabled on the zone, so responsive images
 * rely on pre-generated WebP variants (`<stem>.w<W>.webp`) created at upload
 * time. Media uploaded BEFORE that feature exists only as a full-resolution
 * original. This script walks the public bucket, finds original images that
 * lack variants, and generates + uploads them.
 *
 * Idempotent: skips any image whose variants already exist. Safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-image-variants.mjs            # dry-run (no writes)
 *   node scripts/backfill-image-variants.mjs --write    # actually upload
 *   node scripts/backfill-image-variants.mjs --write --limit=50
 *
 * Reads R2 credentials from .env.local (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET).
 */

import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

// ── Config ───────────────────────────────────────────────────────────────
const VARIANT_WIDTHS = [400, 800, 1600];
const VARIANT_QUALITY = { 400: 80, 800: 82, 1600: 85 };
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
const PREFIXES = ["media/", "listings/"];
const CONCURRENCY = 4;

// ── Env ──────────────────────────────────────────────────────────────────
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

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// sharp is ESM/CJS interop — dynamic import.
const sharp = (await import("sharp")).default;

// ── Helpers ──────────────────────────────────────────────────────────────
const isVariantKey = (key) => /\.w\d+\.webp$/.test(key);
const extOf = (key) => key.split(".").pop()?.toLowerCase() ?? "";
const variantKeyFor = (key, width) => {
  const dot = key.lastIndexOf(".");
  const stem = dot > 0 ? key.slice(0, dot) : key;
  return `${stem}.w${width}.webp`;
};

async function objectExists(key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function* listAllObjects() {
  for (const prefix of PREFIXES) {
    let token;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      );
      for (const obj of res.Contents ?? []) yield obj.Key;
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }
}

async function processImage(key) {
  // Download original
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const buffer = Buffer.from(await res.Body.transformToByteArray());

  const meta = await sharp(buffer, { failOn: "none" }).rotate().metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (srcW === 0 || srcH === 0) return { key, generated: 0, skipped: "undecodable" };

  const longEdge = Math.max(srcW, srcH);
  let generated = 0;

  for (const width of VARIANT_WIDTHS) {
    if (width >= longEdge) continue;
    const variantKey = variantKeyFor(key, width);
    if (await objectExists(variantKey)) continue; // idempotent

    const resized = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({
        width: srcW >= srcH ? width : undefined,
        height: srcH > srcW ? width : undefined,
        withoutEnlargement: true,
      })
      .webp({ quality: VARIANT_QUALITY[width] ?? 82 })
      .toBuffer();

    if (WRITE) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: variantKey,
          Body: resized,
          ContentType: "image/webp",
        })
      );
    }
    generated++;
  }
  return { key, generated };
}

// ── Main ─────────────────────────────────────────────────────────────────
console.log(`Mode: ${WRITE ? "WRITE" : "DRY-RUN"} | bucket: ${bucket} | limit: ${LIMIT}`);

let scanned = 0;
let processed = 0;
let totalGenerated = 0;
const inFlight = new Set();

async function runOne(key) {
  try {
    const r = await processImage(key);
    if (r.generated > 0) {
      totalGenerated += r.generated;
      console.log(`  + ${key} → ${r.generated} variant(s)`);
    }
  } catch (err) {
    console.error(`  ! ${key}: ${err instanceof Error ? err.message : err}`);
  }
}

for await (const key of listAllObjects()) {
  if (!key || isVariantKey(key) || !IMAGE_EXTS.has(extOf(key))) continue;
  scanned++;
  if (processed >= LIMIT) break;
  processed++;

  const p = runOne(key).finally(() => inFlight.delete(p));
  inFlight.add(p);
  if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
}
await Promise.all(inFlight);

console.log(`\nScanned ${scanned} originals, processed ${processed}, generated ${totalGenerated} variant(s).`);
if (!WRITE) console.log("Dry-run — re-run with --write to upload variants.");
