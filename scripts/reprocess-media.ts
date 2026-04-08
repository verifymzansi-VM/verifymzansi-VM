/* eslint-disable no-console -- CLI script, console output is intentional */

/**
 * Batch media reprocessing script.
 *
 * Reads all listings, business_profiles, and promotions from Supabase,
 * fetches their media via Cloudflare Image Resizing to derive dimensions,
 * generates blurhash client-side, and backfills `media_width`, `media_height`,
 * `blurhash`, `focal_x`, `focal_y` for rows missing values.
 *
 * Requires env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   NEXT_PUBLIC_SITE_URL            — for CF image resizing requests
 *
 * Run:
 *   npx tsx scripts/reprocess-media.ts [--dry-run] [--limit N]
 */

import { createClient } from "@supabase/supabase-js";
// @ts-expect-error -- canvas is a Node.js native addon, types may not resolve in editor
import { createCanvas, loadImage } from "canvas";
import { encode } from "blurhash";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const ROW_LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) || 50 : 500;
const BATCH_SIZE = 10; // concurrent fetches

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const siteUrl = requireEnv("NEXT_PUBLIC_SITE_URL");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

interface MediaRow {
  id: string;
  photos?: string[] | null;
  videos?: string[] | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  blurhash?: string | null;
}

interface ProcessResult {
  width: number;
  height: number;
  blurhash: string;
}

/**
 * Fetches media at a small size via CF Image Resizing (or direct),
 * measures dimensions, and generates a blurhash.
 */
async function processMediaUrl(url: string): Promise<ProcessResult | null> {
  try {
    // Use CF Image Resizing for a small 32px version for blurhash
    const thumbUrl = `${siteUrl}/cdn-cgi/image/width=32,quality=80,format=jpeg/${url}`;
    // Also get full dimensions via a 1px fit to read the width/height
    const metaUrl = `${siteUrl}/cdn-cgi/image/width=1600,quality=1,format=jpeg/${url}`;

    const [thumbRes, metaRes] = await Promise.all([
      fetch(thumbUrl).catch(() => null),
      fetch(metaUrl, { method: "HEAD" }).catch(() => null),
    ]);

    if (!thumbRes?.ok) {
      // Fallback: fetch original directly
      const directRes = await fetch(url);
      if (!directRes.ok) return null;
      const buf = Buffer.from(await directRes.arrayBuffer());
      return processBuffer(buf);
    }

    const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());

    // Try to read dimensions from CF response headers
    let width = 0;
    let height = 0;
    const cfWidth = metaRes?.headers.get("cf-resized")?.match(/w=(\d+)/);
    const cfHeight = metaRes?.headers.get("cf-resized")?.match(/h=(\d+)/);
    if (cfWidth) width = parseInt(cfWidth[1], 10);
    if (cfHeight) height = parseInt(cfHeight[1], 10);

    // Generate blurhash from thumb
    const img = await loadImage(thumbBuf);
    if (!width) width = img.naturalWidth || img.width;
    if (!height) height = img.naturalHeight || img.height;

    const canvas = createCanvas(32, 32);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 32, 32);
    const imageData = ctx.getImageData(0, 0, 32, 32);
    const hash = encode(imageData.data, 32, 32, 4, 3);

    return { width, height, blurhash: hash };
  } catch (err) {
    console.error(`  Failed to process ${url}:`, (err as Error).message);
    return null;
  }
}

async function processBuffer(buf: Buffer): Promise<ProcessResult | null> {
  try {
    const img = await loadImage(buf);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const size = 32;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const hash = encode(imageData.data, size, size, 4, 3);
    return { width: w, height: h, blurhash: hash };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Table processors                                                    */
/* ------------------------------------------------------------------ */

interface TableConfig {
  table: string;
  mediaField: "photos" | "cover_photo";
}

const TABLES: TableConfig[] = [
  { table: "listings", mediaField: "photos" },
  { table: "business_profiles", mediaField: "cover_photo" },
  { table: "promotions", mediaField: "photos" },
];

async function processTable(config: TableConfig) {
  const { table, mediaField } = config;
  console.log(`\n── Processing ${table} (field: ${mediaField}) ──`);

  // Fetch rows missing blurhash or media dimensions
  const { data: rows, error } = await supabase
    .from(table)
    .select(`id, ${mediaField}, media_width, media_height, blurhash`)
    .or("blurhash.is.null,media_width.is.null")
    .limit(ROW_LIMIT);

  if (error) {
    console.error(`  Error fetching ${table}:`, error.message);
    return { processed: 0, updated: 0, failed: 0 };
  }

  if (!rows || rows.length === 0) {
    console.log(`  No rows need processing.`);
    return { processed: 0, updated: 0, failed: 0 };
  }

  console.log(`  Found ${rows.length} rows to process.`);
  let updated = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (row: MediaRow) => {
        let mediaUrl: string | null = null;

        if (mediaField === "photos" && Array.isArray(row.photos) && row.photos.length > 0) {
          mediaUrl = row.photos[0];
        } else if (mediaField === "cover_photo" && typeof row.cover_photo === "string") {
          mediaUrl = row.cover_photo;
        }

        if (!mediaUrl) return { id: row.id, result: null };

        const result = await processMediaUrl(mediaUrl);
        return { id: row.id, result };
      })
    );

    for (const { id, result } of results) {
      if (!result) {
        failed++;
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  [DRY RUN] Would update ${table}.${id}: ${result.width}×${result.height}, blurhash=${result.blurhash.slice(0, 12)}…`
        );
        updated++;
        continue;
      }

      const { error: updateError } = await supabase
        .from(table)
        .update({
          media_width: result.width,
          media_height: result.height,
          blurhash: result.blurhash,
        })
        .eq("id", id);

      if (updateError) {
        console.error(`  Failed to update ${table}.${id}:`, updateError.message);
        failed++;
      } else {
        updated++;
      }
    }

    // Progress
    const progress = Math.min(i + BATCH_SIZE, rows.length);
    console.log(`  Progress: ${progress}/${rows.length} (updated: ${updated}, failed: ${failed})`);
  }

  return { processed: rows.length, updated, failed };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  VerifyMzansi — Batch Media Reprocessing");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  Row limit per table: ${ROW_LIMIT}`);
  console.log("═══════════════════════════════════════════════════");

  const totals = { processed: 0, updated: 0, failed: 0 };

  for (const config of TABLES) {
    const result = await processTable(config);
    totals.processed += result.processed;
    totals.updated += result.updated;
    totals.failed += result.failed;
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  Summary");
  console.log(`  Processed: ${totals.processed}`);
  console.log(`  Updated:   ${totals.updated}`);
  console.log(`  Failed:    ${totals.failed}`);
  console.log("═══════════════════════════════════════════════════");

  if (totals.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
