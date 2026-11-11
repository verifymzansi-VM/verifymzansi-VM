import { type NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isPlaywrightFoundationCopy } from "@/lib/supabase/playwright-mode";
import {
  isVideoContentType,
  rangeStillValid,
  resolveByteRange,
  type ByteRangeAnswer,
} from "@/lib/media/byte-range";
import { detectMimeFromMagicBytes } from "@/lib/utils/file-validation";

const logger = createLogger("MediaServe");

/**
 * Media proxy – reads objects from the public R2 bucket and returns them
 * with long-lived cache headers.  Supports HTTP Range requests for video
 * seeking and progressive playback.
 *
 * Performance: In production this route proxies R2 over the S3-compatible
 * HTTP API — wrangler.toml deliberately omits native R2 bindings because
 * Cloudflare rejects Worker version creation for this account (error 10136).
 * When a native R2 bucket binding IS present (e.g. a future re-enablement),
 * it is used as an in-worker fast path with zero network hop, similar to
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
  head(key: string): Promise<{
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
    // R2 rejects the SDK ≥3.729 default flexible checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  _configKey = ck;
  return _client;
}

function buildPublicMediaUrl(key: string, bucket: string): string | null {
  const r2PublicBase = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  if (r2PublicBase) {
    return `${r2PublicBase}/${key}`;
  }

  const mediaBase = process.env.NEXT_PUBLIC_MEDIA_URL?.replace(/\/+$/, "");
  if (mediaBase) {
    return `${mediaBase}/${key}`;
  }

  // Deliberately no fallback to https://<bucket>.<account>.r2.cloudflarestorage.com:
  // that endpoint requires auth and returns AccessDenied XML, so redirecting
  // there would just serve a broken response. Callers must 503 instead.
  void bucket;
  return null;
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

const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/** The type a key's file extension names, if it names one (own entries only). */
function extensionContentType(ext: string): string | undefined {
  return Object.hasOwn(MIME_MAP, ext) ? MIME_MAP[ext] : undefined;
}

/**
 * The type to serve. A known extension wins over stored metadata: a direct
 * upload could have stored a bogus contentType (e.g. text/html on a .jpg key),
 * and serving it inline from the app origin would enable stored XSS. Keys made
 * by the live backend (`media/<uuid>`) have no extension; their type is the one
 * the upload recorded after checking the file's own bytes.
 */
function contentTypeFor(ext: string, storedType: string | undefined): string {
  return extensionContentType(ext) ?? storedType ?? "application/octet-stream";
}

/** Whether the object could be a video, before its stored type is read. */
function mayBeVideo(ext: string): boolean {
  const named = extensionContentType(ext);
  return named === undefined || isVideoContentType(named);
}

function isSvgType(contentType: string): boolean {
  return contentType.split(";")[0].trim().toLowerCase() === "image/svg+xml";
}

/**
 * How to answer the request's Range header once the object's size, type and
 * ETag are known. Only videos are served in parts; anything else is whole.
 */
function planRange(
  request: NextRequest,
  size: number,
  contentType: string,
  etag: string | undefined
): ByteRangeAnswer {
  if (!isVideoContentType(contentType)) return { type: "full" };
  if (!rangeStillValid(request.headers.get("if-range"), etag)) return { type: "full" };
  return resolveByteRange(request.headers.get("range"), size);
}

function partialContent(
  body: ReadableStream | Uint8Array,
  key: string,
  contentType: string,
  range: { start: number; end: number; length: number },
  size: number,
  etag: string | undefined
): NextResponse {
  return new NextResponse(body as BodyInit, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(range.length),
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": IMMUTABLE_CACHE,
      "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
      ...(etag ? { ETag: etag } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** 416 carries no Cache-Control here, so GET marks it `private, no-store`. */
function rangeNotSatisfiable(size: number): NextResponse {
  return new NextResponse(null, {
    status: 416,
    headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
  });
}

/**
 * If the requested key is a pre-generated responsive variant
 * (`<stem>.w<width>.webp`), return the original key it was derived from.
 * Returns null for non-variant keys. Variants are generated at upload time;
 * media uploaded before variants existed (or whose variant upload failed)
 * will 404 on the variant key, so the serve route falls back to the original.
 */
function originalKeyForVariant(key: string): string | null {
  const match = key.match(/^(.*)\.w\d+\.webp$/);
  if (!match) return null;
  // We don't know the original extension from the variant key alone. Try the
  // common raster extensions in order; the caller checks existence.
  return match[1];
}

/** Candidate original extensions to probe when a variant key is missing. */
const VARIANT_ORIGINAL_EXTS = ["jpg", "jpeg", "png", "webp", "avif", "gif"];

/**
 * Derive a filename for the Content-Disposition header from the storage key.
 * Generated keys never contain the original filename (e.g.
 * "media/listing/<ownerId>/17200000-a1b2c3d4.jpg"), so this returns the last
 * segment with any leading hex timestamp/random prefix stripped.
 */
function deriveFilename(key: string): string {
  const lastSegment = key.split("/").pop() ?? key;
  // Strip leading timestamp/UUID prefix (e.g. "17200000-" or "a1b2c3d4-")
  const name = lastSegment.replace(/^[\da-f]+-/i, "") || lastSegment;
  // Sanitize for Content-Disposition header: remove quotes, newlines, and control chars
  return name.replace(/["\r\n\x00-\x1f]/g, "_");
}

// ── R2 binding serve path (in-worker, zero network hop) ─────────────
async function serveViaR2Binding(
  r2: R2BucketBinding,
  request: NextRequest,
  key: string,
  ext: string,
  ifNoneMatch: string | null,
  rangeHeader: string | null
): Promise<NextResponse> {
  // ── Video with Range → 206 Partial Content ──────────────────────────
  // The stored type decides whether this is a video, so read it first.
  if (rangeHeader && mayBeVideo(ext)) {
    const head = await r2.head(key);
    if (!head || head.size === 0) {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = contentTypeFor(ext, head.httpMetadata?.contentType);
    const range = planRange(request, head.size, contentType, head.etag);
    if (range.type === "unsatisfiable") return rangeNotSatisfiable(head.size);
    if (range.type === "partial") {
      // Read only the requested bytes from R2.
      const obj = await r2.get(key, { range: { offset: range.start, length: range.length } });
      if (!obj) {
        return new NextResponse(null, { status: 404 });
      }
      return partialContent(obj.body, key, contentType, range, head.size, head.etag);
    }
  }

  // ── Full object fetch ───────────────────────────────────────────────
  const obj = await r2.get(key);
  if (!obj) {
    return new NextResponse(null, { status: 404 });
  }

  // 304 Not Modified
  if (ifNoneMatch && ifNoneMatch === obj.etag) {
    await obj.body.cancel();
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: obj.etag, "Cache-Control": "public, max-age=31536000, immutable" },
    });
  }

  const contentType = contentTypeFor(ext, obj.httpMetadata?.contentType);

  // Video without Range → stream with Accept-Ranges
  if (isVideoContentType(contentType)) {
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

  const isSvg = isSvgType(contentType);
  const disposition = isSvg
    ? `attachment; filename="${deriveFilename(key)}"`
    : `inline; filename="${deriveFilename(key)}"`;

  return new NextResponse(obj.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(obj.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": disposition,
      ETag: obj.etag,
      "X-Content-Type-Options": "nosniff",
      ...(isSvg
        ? {
            "Content-Security-Policy":
              "default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'",
          }
        : {}),
    },
  });
}

/**
 * Serve a single resolved storage key. Extracted from GET so the variant
 * fallback wrapper can retry with the original key when a pre-generated
 * responsive variant object does not exist yet.
 */
async function serveMediaForKey(request: NextRequest, key: string): Promise<NextResponse> {
  // ── Conditional GET (If-None-Match) ─────────────────────────────────
  const ifNoneMatch = request.headers.get("if-none-match");
  const rangeHeader = request.headers.get("range");

  const ext = key.split(".").pop()?.toLowerCase() ?? "";

  // ── Playwright e2e stub: serve uploads written to public/e2e-media ──
  // uploadToR2 writes to the local filesystem in stub mode, but this route
  // otherwise falls through to the S3 API with fake credentials — producing
  // TLS handshake errors and test timeouts. Serve the local file directly.
  // The local foundation test copy (M0.7) stores its media the same way.
  if (
    (process.env.PLAYWRIGHT_TEST_MODE === "1" && process.env.PLAYWRIGHT_SUPABASE_MODE === "stub") ||
    isPlaywrightFoundationCopy()
  ) {
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const filePath = path.join(process.cwd(), "public", "e2e-media", key);
      const buffer = await fs.readFile(filePath);
      // Local files carry no stored type. Use the type the upload would have
      // recorded: the one the file's own first bytes show (photo or video only).
      const sniffed = detectMimeFromMagicBytes(buffer);
      const contentType = contentTypeFor(
        ext,
        sniffed && /^(image|video)\//.test(sniffed) ? sniffed : undefined
      );
      const range = planRange(request, buffer.length, contentType, undefined);
      if (range.type === "unsatisfiable") return rangeNotSatisfiable(buffer.length);
      if (range.type === "partial") {
        const part = new Uint8Array(buffer.subarray(range.start, range.end + 1));
        return partialContent(part, key, contentType, range, buffer.length, undefined);
      }
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(buffer.length),
          ...(isVideoContentType(contentType) ? { "Accept-Ranges": "bytes" } : {}),
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Disposition": `inline; filename="${deriveFilename(key)}"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }

  try {
    // ── Try native R2 binding first (in-worker, ~2-5x faster) ─────────
    const r2 = await getR2Binding();
    if (r2) {
      const bindingResponse = await serveViaR2Binding(
        r2,
        request,
        key,
        ext,
        ifNoneMatch,
        rangeHeader
      );
      const allowDevFallbackToS3 =
        bindingResponse.status === 404 && process.env.NODE_ENV !== "production";

      if (!allowDevFallbackToS3) {
        return bindingResponse;
      }
    }

    // ── Fallback: S3-compatible HTTP API (local dev / no binding) ──────
    const bucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
    let client: S3Client;
    try {
      client = getClient();
    } catch (credentialError: unknown) {
      if (
        credentialError instanceof Error &&
        credentialError.message === "R2 credentials not configured"
      ) {
        const publicUrl = buildPublicMediaUrl(key, bucket);
        if (publicUrl) {
          return NextResponse.redirect(new URL(publicUrl), { status: 307 });
        }

        return NextResponse.json(
          {
            error:
              "Media service misconfigured: no R2 credentials and no public media URL configured",
          },
          { status: 503 }
        );
      }

      throw credentialError;
    }

    // ── Video with Range header → 206 Partial Content ─────────────────
    // The stored type decides whether this is a video, so read it first.
    if (rangeHeader && mayBeVideo(ext)) {
      // HEAD request to get total size and stored type
      const headCommand = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const headResponse = await client.send(headCommand);
      const totalSize = headResponse.ContentLength ?? 0;

      if (totalSize === 0) {
        return new NextResponse(null, { status: 404 });
      }

      const contentType = contentTypeFor(ext, headResponse.ContentType);
      const range = planRange(request, totalSize, contentType, headResponse.ETag);
      if (range.type === "unsatisfiable") return rangeNotSatisfiable(totalSize);
      if (range.type === "partial") {
        // Fetch only the requested range from R2. The bounds are this route's
        // own numbers, never the client's header text.
        const rangeCommand = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${range.start}-${range.end}`,
        });
        const rangeResponse = await client.send(rangeCommand);

        if (!rangeResponse.Body) {
          return new NextResponse(null, { status: 404 });
        }

        // Stream the response body directly instead of buffering
        return partialContent(
          rangeResponse.Body.transformToWebStream(),
          key,
          contentType,
          range,
          totalSize,
          headResponse.ETag
        );
      }
    }

    // ── Non-range request ─────────────────────────────────────────────
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);

    if (!response.Body) {
      return new NextResponse(null, { status: 404 });
    }

    // Support 304 Not Modified
    if (ifNoneMatch && response.ETag && ifNoneMatch === response.ETag) {
      await response.Body.transformToWebStream().cancel();
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: response.ETag, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }

    // Prefer the extension-derived MIME over stored metadata (see contentTypeFor).
    const contentType = contentTypeFor(ext, response.ContentType);

    // For video files, stream the response and include Accept-Ranges
    if (isVideoContentType(contentType)) {
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

    // Stream images as well as video. R2 metadata supplies the content length;
    // buffering each original and fallback probe multiplies isolate memory use.
    const body = response.Body.transformToWebStream();

    // SVG files can contain embedded scripts — force download instead of inline rendering
    const isSvg = isSvgType(contentType);
    const disposition = isSvg
      ? `attachment; filename="${deriveFilename(key)}"`
      : `inline; filename="${deriveFilename(key)}"`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...(response.ContentLength != null
          ? { "Content-Length": String(response.ContentLength) }
          : {}),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": disposition,
        ...(response.ETag ? { ETag: response.ETag } : {}),
        "X-Content-Type-Options": "nosniff",
        // Block SVG from executing scripts when served from same-origin
        ...(isSvg
          ? {
              "Content-Security-Policy":
                "default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'",
            }
          : {}),
      },
    });
  } catch (err: unknown) {
    // NoSuchKey (GetObject) or NotFound (HeadObject) → 404
    if (err instanceof Error && (err.name === "NoSuchKey" || err.name === "NotFound")) {
      return new NextResponse(null, { status: 404 });
    }
    logger.error("Media serve error", {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to serve media" }, { status: 500 });
  }
}

async function getMediaResponse(
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

  // Rate-limit: generous threshold (public CDN-cached content). The Playwright
  // e2e suite issues hundreds of media requests (image retries, video range
  // probes, retries of failed tests) from a single IP, so skip the local
  // in-memory limiter in stub mode to avoid starving the server.
  const isE2eStub =
    process.env.PLAYWRIGHT_TEST_MODE === "1" && process.env.PLAYWRIGHT_SUPABASE_MODE === "stub";
  const ip = getClientIp(request);
  const rl = isE2eStub ? { limited: false } : checkLocalRateLimit(ip, "media:serve", 300);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter ?? 60) },
      }
    );
  }

  const response = await serveMediaForKey(request, key);

  // Variant fallback: a pre-generated responsive variant (`<stem>.w<N>.webp`)
  // only exists for media uploaded after variants were introduced. When the
  // variant object is missing, serve the original image instead of a 404 so
  // older media keeps rendering. We probe the common raster extensions.
  if (response.status === 404) {
    const stem = originalKeyForVariant(key);
    if (stem) {
      // Probe all candidate extensions in parallel — the previous sequential
      // loop added up to 6 serial R2/S3 round-trips of latency per image for
      // legacy media without pre-generated variants.
      const probes = await Promise.all(
        VARIANT_ORIGINAL_EXTS.map((originalExt) =>
          serveMediaForKey(request, `${stem}.${originalExt}`)
        )
      );
      // A failure probing one extension must not hide an existing original.
      const hit =
        probes.find((probe) => probe.ok || probe.status === 304) ??
        probes.find((probe) => probe.status !== 404);
      await Promise.allSettled(
        probes.filter((probe) => probe !== hit).map((probe) => probe.body?.cancel())
      );
      if (hit) {
        // The original can be replaced by a generated variant at this URL.
        // Do not cache the temporary fallback as immutable for a year.
        if (hit.ok || hit.status === 304) {
          hit.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
        }
        return hit;
      }
    }
  }

  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ key: string[] }> }) {
  const response = await getMediaResponse(request, context);
  // Errors, throttling and redirects must not inherit immutable asset caching.
  if (!response.headers.has("Cache-Control")) {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}
