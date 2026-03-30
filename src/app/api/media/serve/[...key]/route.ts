import { type NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("MediaServe");

/**
 * Media proxy – reads objects from the public R2 bucket and returns them
 * with long-lived cache headers.  Supports HTTP Range requests for video
 * seeking and progressive playback.
 *
 * Performance: When running on Cloudflare Workers, this route uses the
 * native R2 bucket binding (in-worker, zero network hop) instead of
 * the S3-compatible HTTP API. This eliminates external TLS handshakes
 * and network round-trips, serving images ~2-5x faster — similar to
 * how YouTube/Facebook serve media from edge CDN rather than proxying
 * through application servers.
 *
 * URL pattern:  /api/media/serve/<key…>
 * Example:      /api/media/serve/media/listing/abc123/17200000-xyz.jpg
 */

// ── R2 Binding types (matches @cloudflare/workers-types) ────────────────
interface R2ObjectBody {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: { contentType?: string };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface R2BucketBinding {
  get(
    key: string,
    options?: { range?: { offset: number; length: number } }
  ): Promise<R2ObjectBody | null>;
  head(
    key: string
  ): Promise<{
    key: string;
    size: number;
    etag: string;
    httpMetadata?: { contentType?: string };
  } | null>;
}

// ── R2 binding accessor (zero-cost in-worker path) ──────────────────────
async function getR2Binding(): Promise<R2BucketBinding | null> {
  // Fast path: check process.env (OpenNext sometimes exposes bindings here)
  const processEnv = process.env as unknown as Record<string, unknown>;
  if (isR2Binding(processEnv.PUBLIC_BUCKET)) return processEnv.PUBLIC_BUCKET;

  // Check globalThis symbols used by OpenNext
  const contextSymbol = Symbol.for("__cloudflare-context__");
  const globalScope = globalThis as Record<PropertyKey, unknown>;
  const context = globalScope[contextSymbol] as { env?: Record<string, unknown> } | undefined;
  if (context?.env && isR2Binding(context.env.PUBLIC_BUCKET)) {
    return context.env.PUBLIC_BUCKET;
  }

  // Check globalThis.env / globalThis.__env__
  const env = globalScope.env as Record<string, unknown> | undefined;
  if (env && isR2Binding(env.PUBLIC_BUCKET)) return env.PUBLIC_BUCKET;
  const __env__ = globalScope.__env__ as Record<string, unknown> | undefined;
  if (__env__ && isR2Binding(__env__.PUBLIC_BUCKET)) return __env__.PUBLIC_BUCKET;

  // Last resort: OpenNext async context
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const cfEnv = ctx.env as Record<string, unknown>;
    if (isR2Binding(cfEnv.PUBLIC_BUCKET)) return cfEnv.PUBLIC_BUCKET;
  } catch {
    // Not in Cloudflare context (local dev) — fall through to S3
  }

  return null;
}

function isR2Binding(value: unknown): value is R2BucketBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.get === "function" && typeof candidate.head === "function";
}

// ── S3 fallback for local development ───────────────────────────────────
let _client: S3Client | null = null;
let _configKey: string | null = null;

function getClient(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  const ck = `${accountId}:${accessKeyId}`;
  if (_client && _configKey === ck) return _client;

  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  _configKey = ck;
  return _client;
}

// ── Extension → MIME fallback table ─────────────────────────────────────
// Note: MOV support added to enable playback of legacy .mov files uploaded
// before video format hardening (2026-03-28). New uploads accept only mp4/webm.
const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "video/ogg",
  mov: "video/quicktime",
};

// Supported video extensions for streaming with Range request support.
// MOV files added to support legacy uploads; new uploads restricted to mp4/webm.
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "mov"]);

/**
 * Derive a human-friendly filename from the storage key.
 * e.g. "media/listing/abc123/17200000-photo.jpg" → "photo.jpg"
 */
function deriveFilename(key: string): string {
  const lastSegment = key.split("/").pop() ?? key;
  // Strip leading timestamp/UUID prefix (e.g. "17200000-" or "a1b2c3d4-")
  const name = lastSegment.replace(/^[\da-f]+-/i, "") || lastSegment;
  // Sanitize for Content-Disposition header: remove quotes, newlines, and control chars
  return name.replace(/["\r\n\x00-\x1f]/g, "_");
}

/**
 * Parse an HTTP Range header like "bytes=0-1023" into start/end numbers.
 * Returns null if the header is missing or malformed.
 */
function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number
): { start: number; end: number } | null {
  if (!rangeHeader) return null;

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startStr, endStr] = match;

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    // Suffix range: "bytes=-500" → last 500 bytes
    const suffix = parseInt(endStr, 10);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // Open-ended range: "bytes=500-" → from 500 to end
    start = parseInt(startStr, 10);
    end = totalSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    // Explicit range: "bytes=500-1023"
    start = parseInt(startStr, 10);
    end = Math.min(parseInt(endStr, 10), totalSize - 1);
  } else {
    return null;
  }

  if (start > end || start < 0 || start >= totalSize) return null;

  return { start, end };
}

// ── R2 binding serve path (in-worker, zero network hop) ─────────────
async function serveViaR2Binding(
  r2: R2BucketBinding,
  key: string,
  ext: string,
  isVideo: boolean,
  ifNoneMatch: string | null,
  rangeHeader: string | null
): Promise<NextResponse> {
  // ── Video with Range → 206 Partial Content ──────────────────────────
  if (isVideo && rangeHeader) {
    const head = await r2.head(key);
    if (!head || head.size === 0) {
      return new NextResponse(null, { status: 404 });
    }

    const range = parseRangeHeader(rangeHeader, head.size);
    if (!range) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head.size}` },
      });
    }

    const { start, end } = range;
    const contentLength = end - start + 1;
    const contentType =
      head.httpMetadata?.contentType || MIME_MAP[ext] || "application/octet-stream";

    const obj = await r2.get(key, { range: { offset: start, length: contentLength } });
    if (!obj) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(obj.body, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(contentLength),
        "Content-Range": `bytes ${start}-${end}/${head.size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
        ETag: head.etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // ── Full object fetch ───────────────────────────────────────────────
  const obj = await r2.get(key);
  if (!obj) {
    return new NextResponse(null, { status: 404 });
  }

  // 304 Not Modified
  if (ifNoneMatch && ifNoneMatch === obj.etag) {
    return new NextResponse(null, { status: 304 });
  }

  const contentType = obj.httpMetadata?.contentType || MIME_MAP[ext] || "application/octet-stream";

  // Video without Range → stream with Accept-Ranges
  if (isVideo) {
    return new NextResponse(obj.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(obj.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
        ETag: obj.etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Image → buffer for Content-Length accuracy
  const buffer = await obj.arrayBuffer();

  const isSvg = ext === "svg";
  const disposition = isSvg
    ? `attachment; filename="${deriveFilename(key)}"`
    : `inline; filename="${deriveFilename(key)}"`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(obj.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": disposition,
      ETag: obj.etag,
      "X-Content-Type-Options": "nosniff",
      ...(isSvg
        ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }
        : {}),
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const segments = (await params).key;

  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const key = segments.join("/");

  // Security: reject path traversal and null bytes
  if (key.includes("..") || key.includes("\0") || key.includes("\\")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  // Security: only serve known public-bucket prefixes
  const ALLOWED_PREFIXES = ["media/", "listings/"];
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  // ── Conditional GET (If-None-Match) ─────────────────────────────────
  const ifNoneMatch = request.headers.get("if-none-match");
  const rangeHeader = request.headers.get("range");

  try {
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    const isVideo = VIDEO_EXTENSIONS.has(ext);

    // ── Try native R2 binding first (in-worker, ~2-5x faster) ─────────
    const r2 = await getR2Binding();
    if (r2) {
      return await serveViaR2Binding(r2, key, ext, isVideo, ifNoneMatch, rangeHeader);
    }

    // ── Fallback: S3-compatible HTTP API (local dev / no binding) ──────
    const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
    const client = getClient();

    // ── Video with Range header → 206 Partial Content ─────────────────
    if (isVideo && rangeHeader) {
      // HEAD request to get total size
      const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const headResponse = await client.send(headCommand);
      const totalSize = headResponse.ContentLength ?? 0;

      if (totalSize === 0) {
        return new NextResponse(null, { status: 404 });
      }

      const range = parseRangeHeader(rangeHeader, totalSize);
      if (!range) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${totalSize}` },
        });
      }

      const { start, end } = range;
      const contentLength = end - start + 1;
      const contentType = headResponse.ContentType || MIME_MAP[ext] || "application/octet-stream";

      // Fetch only the requested range from R2
      const rangeCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${start}-${end}`,
      });
      const rangeResponse = await client.send(rangeCommand);

      if (!rangeResponse.Body) {
        return new NextResponse(null, { status: 404 });
      }

      // Stream the response body directly instead of buffering
      const webStream = rangeResponse.Body.transformToWebStream();

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
          ...(headResponse.ETag ? { ETag: headResponse.ETag } : {}),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // ── Non-range request ─────────────────────────────────────────────
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);

    if (!response.Body) {
      return new NextResponse(null, { status: 404 });
    }

    // Support 304 Not Modified
    if (ifNoneMatch && response.ETag && ifNoneMatch === response.ETag) {
      return new NextResponse(null, { status: 304 });
    }

    const contentType = response.ContentType || MIME_MAP[ext] || "application/octet-stream";

    // For video files, stream the response and include Accept-Ranges
    if (isVideo) {
      const webStream = response.Body.transformToWebStream();

      return new NextResponse(webStream, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          ...(response.ContentLength != null
            ? { "Content-Length": String(response.ContentLength) }
            : {}),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
          ...(response.ETag ? { ETag: response.ETag } : {}),
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // For non-video files (images), buffer is fine (they're small)
    const bodyBytes = await response.Body.transformToByteArray();
    const buffer = Buffer.from(bodyBytes);

    // SVG files can contain embedded scripts — force download instead of inline rendering
    const isSvg = ext === "svg";
    const disposition = isSvg
      ? `attachment; filename="${deriveFilename(key)}"`
      : `inline; filename="${deriveFilename(key)}"`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": disposition,
        ...(response.ETag ? { ETag: response.ETag } : {}),
        "X-Content-Type-Options": "nosniff",
        // Block SVG from executing scripts when served from same-origin
        ...(isSvg
          ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }
          : {}),
      },
    });
  } catch (err: unknown) {
    // NoSuchKey → 404
    if (err instanceof Error && err.name === "NoSuchKey") {
      return new NextResponse(null, { status: 404 });
    }
    logger.error("Media serve error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Failed to serve media" }, { status: 500 });
  }
}
