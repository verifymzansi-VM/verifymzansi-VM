import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { R2Bucket } from "@cloudflare/workers-types";
import { encryptFile, decryptFile } from "@/lib/utils/encryption";
import { createLogger } from "@/lib/utils/logger";
import { isPlaywrightFoundationCopy } from "@/lib/supabase/playwright-mode";

const log = createLogger("Storage");

/** Local files instead of R2: the local foundation test copy only. It requires
 * test mode, which production can never enable. */
function shouldUsePlaywrightStorage(): boolean {
  return isPlaywrightFoundationCopy();
}

async function playwrightStoragePath(bucket: string, key: string): Promise<string | null> {
  if (!shouldUsePlaywrightStorage()) return null;
  const path = await import("node:path");
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
  const publicBucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";
  const root =
    bucket === privateBucket
      ? ["tmp", "e2e-private-storage"]
      : bucket === publicBucket
        ? ["public", "e2e-media"]
        : null;
  if (!root) throw new Error("Unknown isolated storage bucket");
  const directory = path.resolve(process.cwd(), ...root);
  const target = path.resolve(path.join(directory, key));
  if (!target.startsWith(directory + path.sep)) throw new Error("Invalid isolated storage path");
  return target;
}

/**
 * R2-compatible object storage helpers for listing images
 * and verification documents.
 */

type R2BucketBinding = Pick<R2Bucket, "put" | "get" | "head" | "delete">;

type CloudflareContextLike = {
  env?: Record<string, unknown>;
};

type GlobalScopeWithEnv = Record<PropertyKey, unknown> & {
  env?: Record<string, unknown>;
  __env__?: Record<string, unknown>;
};

function isR2BucketBinding(value: unknown): value is R2BucketBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.put === "function" &&
    typeof candidate.get === "function" &&
    typeof candidate.head === "function" &&
    typeof candidate.delete === "function"
  );
}

function getBindingFromEnvObject(
  bucketName: string,
  envObject: Record<string, unknown>
): R2BucketBinding | null {
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
  const publicBucket = process.env.R2_PUBLIC_BUCKET || "verifymzansi-public";

  if (bucketName === privateBucket && isR2BucketBinding(envObject.PRIVATE_BUCKET)) {
    return envObject.PRIVATE_BUCKET;
  }
  if (bucketName === publicBucket && isR2BucketBinding(envObject.PUBLIC_BUCKET)) {
    return envObject.PUBLIC_BUCKET;
  }

  return null;
}

function getCloudflareContextFromGlobalScope(): CloudflareContextLike | null {
  const contextSymbol = Symbol.for("__cloudflare-context__");
  const globalScope = globalThis as GlobalScopeWithEnv;
  const context = globalScope[contextSymbol] as CloudflareContextLike | undefined;

  if (!context || typeof context !== "object") {
    return null;
  }

  return context;
}

function getR2BucketBindingFromGlobalScope(bucketName: string): R2BucketBinding | null {
  const globalScope = globalThis as GlobalScopeWithEnv;

  if (globalScope.env) {
    const fromEnv = getBindingFromEnvObject(bucketName, globalScope.env);
    if (fromEnv) {
      return fromEnv;
    }
  }

  if (globalScope.__env__) {
    const fromPrivateEnv = getBindingFromEnvObject(bucketName, globalScope.__env__);
    if (fromPrivateEnv) {
      return fromPrivateEnv;
    }
  }

  return getBindingFromEnvObject(bucketName, globalScope);
}

/**
 * Try to obtain a native R2 bucket binding from the Cloudflare Workers context.
 * Returns null when running outside Cloudflare (e.g. local `next dev`).
 *
 * Binding names are defined in wrangler.toml:
 *   - PRIVATE_BUCKET → verifymzansi-private
 *   - PUBLIC_BUCKET  → verifymzansi-public
 */
async function getR2BucketBinding(bucketName: string): Promise<R2BucketBinding | null> {
  // Fast path: some runtimes expose bindings directly via process.env-like object.
  const processEnvCandidate = process.env as unknown as Record<string, unknown>;
  const fromProcessEnv = getBindingFromEnvObject(bucketName, processEnvCandidate);
  if (fromProcessEnv) {
    return fromProcessEnv;
  }

  const fromGlobalScope = getR2BucketBindingFromGlobalScope(bucketName);
  if (fromGlobalScope) {
    return fromGlobalScope;
  }

  const globalContext = getCloudflareContextFromGlobalScope();
  if (globalContext?.env) {
    const fromGlobalContext = getBindingFromEnvObject(bucketName, globalContext.env);
    if (fromGlobalContext) {
      return fromGlobalContext;
    }
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const binding = getBindingFromEnvObject(bucketName, ctx.env as Record<string, unknown>);
    if (!binding) {
      const envKeys = ctx.env ? Object.keys(ctx.env as Record<string, unknown>) : [];
      log.warn("getCloudflareContext succeeded but binding not found", {
        bucketName,
        availableBindings: envKeys.filter((k) => /bucket/i.test(k)),
        envKeyCount: envKeys.length,
      });
    }
    return binding;
  } catch (err) {
    log.warn("getCloudflareContext import/call failed — falling back to S3 API", {
      bucketName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Read a string value from the Cloudflare Workers env object (via ALS or OpenNext context).
 * Falls back to process.env. This is more reliable than process.env alone because
 * OpenNext's populateProcessEnv only runs once and may miss values in some edge cases.
 */
async function getCloudflareEnvValue(key: string): Promise<string | undefined> {
  // 1. Try the ALS-backed global scope symbol (set by OpenNext's init.js)
  const globalContext = getCloudflareContextFromGlobalScope();
  if (globalContext?.env) {
    const val = (globalContext.env as Record<string, unknown>)[key];
    if (typeof val === "string" && val) return val;
  }

  // 2. Try the @opennextjs/cloudflare async context
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const val = (ctx.env as Record<string, unknown>)[key];
    if (typeof val === "string" && val) return val;
  } catch {
    // Not in Cloudflare context
  }

  // 3. Fallback to process.env
  return process.env[key] || undefined;
}

export async function hasR2WriteAccess(bucketName: string): Promise<boolean> {
  const nativeBinding = await getR2BucketBinding(bucketName);
  if (nativeBinding) {
    log.debug("R2 write access via native binding", { bucketName });
    return true;
  }

  // Check process.env first (fast path), then Cloudflare env directly.
  const hasS3CredsViaProcessEnv = Boolean(
    process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
  );
  if (hasS3CredsViaProcessEnv) {
    log.debug("R2 write access via S3 credentials (process.env)", { bucketName });
    return true;
  }

  // Fallback: read credentials directly from the Cloudflare env object.
  // This handles cases where OpenNext's populateProcessEnv hasn't run yet
  // or process.env writes don't persist in the current runtime.
  const accountId = await getCloudflareEnvValue("R2_ACCOUNT_ID");
  const accessKey = await getCloudflareEnvValue("R2_ACCESS_KEY_ID");
  const secretKey = await getCloudflareEnvValue("R2_SECRET_ACCESS_KEY");
  const hasS3CredsViaCfEnv = Boolean(accountId && accessKey && secretKey);

  if (hasS3CredsViaCfEnv) {
    // Populate process.env so downstream code (getR2Client) can use them.
    process.env.R2_ACCOUNT_ID = accountId;
    process.env.R2_ACCESS_KEY_ID = accessKey;
    process.env.R2_SECRET_ACCESS_KEY = secretKey;
    log.info(
      "R2 write access via S3 credentials (Cloudflare env direct read, populated process.env)",
      { bucketName }
    );
    return true;
  }

  log.warn("No R2 write access: native binding not found and S3 credentials missing", {
    bucketName,
    hasAccountId: Boolean(process.env.R2_ACCOUNT_ID),
    hasAccessKey: Boolean(process.env.R2_ACCESS_KEY_ID),
    hasSecretKey: Boolean(process.env.R2_SECRET_ACCESS_KEY),
    hasAccountIdViaCfEnv: Boolean(accountId),
  });
  return false;
}

interface UploadParams {
  bucket: string;
  key: string;
  file: File | Blob;
  contentType: string;
}

interface UploadResult {
  url: string;
  key: string;
}

/**
 * Validate that a storage key is safe from path traversal attacks.
 * Rejects null bytes, parent directory traversal (including URL-encoded variants),
 * and keys with only whitespace or control characters.
 */
function assertSafeStorageKey(key: string): void {
  const decoded = decodeURIComponent(key);
  // Reject keys that still contain percent-encoded sequences after decoding
  // to prevent double-encoding attacks (e.g. %252e%252e → %2e%2e → ..).
  if (decoded.includes("%")) {
    throw new Error("Invalid storage key");
  }
  // The regex whitelist [\w\-/.] is the primary defense — it rejects
  // backslashes, null bytes, and any non-alphanumeric/punctuation chars.
  if (
    decoded.includes("..") ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    !/^[\w\-/.]+$/.test(decoded)
  ) {
    throw new Error("Invalid storage key");
  }
}

/**
 * Initialize R2 client using S3-compatible API.
 * Cached as a module-level singleton to avoid recreating TLS connections
 * and credential parsing on every upload/download call.
 *
 * "single-attempt" turns off the SDK's own retries (3 attempts by default).
 * Scheduled cleanup uses it so that one call is exactly one Worker
 * subrequest; it retries through its claim/lease cycle instead.
 */
type R2ClientAttempts = "default" | "single-attempt";
const _r2Clients: Partial<Record<R2ClientAttempts, { configKey: string; client: S3Client }>> = {};

function getR2Client(attempts: R2ClientAttempts = "default"): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  // Invalidate singleton if credentials change (e.g. key rotation).
  const configKey = `${accountId}:${accessKeyId}`;
  const cached = _r2Clients[attempts];
  if (cached && cached.configKey === configKey) {
    return cached.client;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // R2 rejects the SDK ≥3.729 default flexible checksums: presigned URLs get
    // a hoisted empty-body CRC32 that breaks PUTs of non-empty files.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(attempts === "single-attempt" ? { maxAttempts: 1 } : {}),
  });
  _r2Clients[attempts] = { configKey, client };
  return client;
}

/**
 * Deadlines for S3-API calls to R2 (used only when no native R2 binding is
 * available). Object transfers (up to the 50 MB video limit) get a generous
 * budget; metadata calls (HEAD/DELETE) should answer quickly. Without these a
 * hung connection holds the request until the platform kills it.
 */
const R2_TRANSFER_TIMEOUT_MS = 120_000;
const R2_METADATA_TIMEOUT_MS = 15_000;

/** A caller's signal (for example a whole job's deadline) still gets the per-call timeout. */
function r2SendOptions(timeoutMs: number, signal?: AbortSignal): { abortSignal: AbortSignal } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return { abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout };
}

/**
 * Thrown by cleanup deletes when storage is overloaded, failing (5xx,
 * SlowDown) or did not answer in time. Callers should send nothing more now
 * and retry on a later run.
 */
class StorageRetryLaterError extends Error {
  readonly retryLater = true;
  constructor(cause: unknown) {
    super("Storage is busy; retry later", { cause });
    this.name = "StorageRetryLaterError";
  }
}

const RETRY_LATER_NAMES = new Set([
  "SlowDown",
  "ServiceUnavailable",
  "InternalError",
  "RequestTimeout",
  "TimeoutError",
  "AbortError",
]);

function asRetryLater(error: unknown): unknown {
  const failure = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  const status = failure?.$metadata?.httpStatusCode;
  return (typeof status === "number" && status >= 500) ||
    (typeof failure?.name === "string" && RETRY_LATER_NAMES.has(failure.name))
    ? new StorageRetryLaterError(error)
    : error;
}

/**
 * Upload a file to Cloudflare R2 using AWS S3-compatible SDK.
 * This properly signs requests using AWS Sigv4.
 */
export async function uploadToR2(params: UploadParams): Promise<UploadResult> {
  assertSafeStorageKey(params.key);
  if (shouldUsePlaywrightStorage()) {
    assertSafeStorageKey(params.key);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const arrayBuffer = await params.file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Private objects (identity evidence) go to the ignored private fixture
    // folder that evidence review reads, never under public/.
    const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
    if (params.bucket === privateBucket) {
      const target = await playwrightStoragePath(params.bucket, params.key);
      if (!target) throw new Error("Isolated private storage unavailable");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
      return { url: "", key: params.key.replace(/\\/g, "/") };
    }
    const publicRoot = path.join(process.cwd(), "public", "e2e-media");
    const destination = path.join(publicRoot, params.key);

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
    const normalizedKey = params.key.replace(/\\/g, "/");
    const url = appUrl ? `${appUrl}/e2e-media/${normalizedKey}` : `/e2e-media/${normalizedKey}`;

    return { url, key: normalizedKey };
  }

  const arrayBuffer = await params.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const cacheControl =
    params.bucket === (process.env.R2_PRIVATE_BUCKET || "verifymzansi-private")
      ? "private, no-store"
      : "public, max-age=31536000, immutable";
  const binding = await getR2BucketBinding(params.bucket);
  if (binding) {
    const result = await binding.put(params.key, new Uint8Array(buffer), {
      httpMetadata: { contentType: params.contentType, cacheControl },
    });
    if (result === null) throw new Error("R2 upload was not confirmed");
  } else {
    const command = new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: buffer,
      ContentType: params.contentType,
      CacheControl: cacheControl,
    });
    await getR2Client().send(command, r2SendOptions(R2_TRANSFER_TIMEOUT_MS));
  }

  // Generate public URL (trim trailing slash from base to avoid double-slash)
  const publicUrl = process.env.R2_PUBLIC_URL
    ? `${process.env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${params.key}`
    : `https://${params.bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${params.key}`;

  return { url: publicUrl, key: params.key };
}

/** A retried evidence request must never overwrite a previously written
 * ciphertext. Return the winning bytes so SQL journals their actual digest. */
export async function putImmutableR2Bytes(
  bucket: string,
  key: string,
  bytes: Buffer,
  metadata: { contentType?: string; cacheControl?: string } = {}
): Promise<Buffer> {
  assertSafeStorageKey(key);
  const fixture = await playwrightStoragePath(bucket, key);
  if (fixture) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(fixture), { recursive: true });
    try {
      await fs.writeFile(fixture, bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return fs.readFile(fixture);
  }
  const binding = await getR2BucketBinding(bucket);
  if (binding) {
    const written = await binding.put(
      key,
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: {
          contentType: metadata.contentType ?? "application/octet-stream",
          cacheControl: metadata.cacheControl ?? "private, no-store",
        },
      }
    );
    if (written) return bytes;
  } else {
    try {
      await getR2Client().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: metadata.contentType ?? "application/octet-stream",
          CacheControl: metadata.cacheControl ?? "private, no-store",
          IfNoneMatch: "*",
        }),
        r2SendOptions(R2_TRANSFER_TIMEOUT_MS)
      );
      return bytes;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
        throw error;
    }
  }
  const existing = await getR2ObjectBytes(bucket, key);
  if (!existing) throw new Error("Immutable object is unavailable");
  return Buffer.from(existing.bytes.buffer, existing.bytes.byteOffset, existing.bytes.byteLength);
}

/**
 * Resolve the file extension for a storage key. Extensionless filenames
 * (e.g. Android content-picker names like "1000061870") would otherwise make
 * the whole filename the "extension", so fall back to the validated declared
 * MIME type — or "jpg" when no type is available.
 */
function resolveStorageExtension(filename: string, declaredMimeType?: string): string {
  const rawExt = filename.includes(".") ? (filename.split(".").pop() ?? "") : "";
  const sanitized = rawExt.replace(/[^a-zA-Z0-9]/g, "");
  const plausible = sanitized.length > 0 && sanitized.length <= 5 && !/^\d+$/.test(sanitized);
  if (plausible) {
    return sanitized;
  }
  return (declaredMimeType ? MIME_TYPE_EXTENSIONS[declaredMimeType] : undefined) ?? "jpg";
}

/** Canonical file extensions for the MIME types accepted by media uploads. */
const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/**
 * Generate a unique key for uploaded files.
 */
export function generateStorageKey(
  prefix: string,
  ownerId: string,
  filename: string,
  declaredMimeType?: string
): string {
  // Sanitize inputs to prevent path traversal in R2 keys.
  // Only allow UUID-safe characters (alphanumeric, hyphens, underscores, slashes for prefix).
  const safePrefix = prefix.replace(/[^a-zA-Z0-9/_-]/g, "");
  const safeOwnerId = ownerId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safeOwnerId) {
    throw new Error("Invalid ownerId for storage key");
  }
  if (safePrefix.includes("..")) {
    throw new Error("Invalid prefix for storage key");
  }
  const ext = resolveStorageExtension(filename, declaredMimeType);
  const timestamp = Date.now();
  const random = globalThis.crypto.randomUUID().slice(0, 8);
  return `${safePrefix}/${safeOwnerId}/${timestamp}-${random}.${ext}`;
}

/**
 * Delete a file from R2.
 * "single-attempt" is for scheduled cleanup that counts its Worker
 * subrequests: exactly one storage request (no SDK retries), the caller's
 * signal applies, and a busy or unanswered request throws
 * StorageRetryLaterError.
 */
export async function deleteFromR2(
  bucket: string,
  key: string,
  options: { attempts?: R2ClientAttempts; signal?: AbortSignal } = {}
): Promise<void> {
  assertSafeStorageKey(key);
  const localPath = await playwrightStoragePath(bucket, key);
  if (localPath) {
    const fs = await import("node:fs/promises");
    await fs.rm(localPath, { force: true });
    return;
  }

  // Prefer native R2 binding when running on Cloudflare Workers.
  const r2Binding = await getR2BucketBinding(bucket);
  if (r2Binding) {
    await r2Binding.delete(key);
    return;
  }

  const attempts = options.attempts ?? "default";
  const client = getR2Client(attempts);
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  try {
    await client.send(command, r2SendOptions(R2_METADATA_TIMEOUT_MS, options.signal));
  } catch (error) {
    throw attempts === "single-attempt" ? asRetryLater(error) : error;
  }
}

/** S3 DeleteObjects and the Workers R2 binding both take at most 1,000 keys. */
export const R2_DELETE_BATCH_LIMIT = 1000;

/**
 * Delete up to 1,000 keys with one storage request and no SDK retries (one
 * Worker subrequest). Returns the keys storage did not confirm as deleted.
 *
 * A key counts as deleted only when the reply lists it under Deleted, or
 * under Errors as NoSuchKey (already gone). Any other requested key is
 * unconfirmed. The reply must account for the request: one that names no
 * requested key at all (an empty or non-S3 200), or an error naming a key
 * that was not requested, throws so the caller can fall back to single
 * deletes. Busy or unanswered requests throw StorageRetryLaterError.
 */
export async function deleteManyFromR2(
  bucket: string,
  keys: readonly string[],
  options: { signal?: AbortSignal } = {}
): Promise<string[]> {
  if (keys.length === 0) return [];
  if (keys.length > R2_DELETE_BATCH_LIMIT || new Set(keys).size !== keys.length) {
    throw new Error("Invalid storage batch");
  }
  keys.forEach(assertSafeStorageKey);
  if (shouldUsePlaywrightStorage()) {
    const fs = await import("node:fs/promises");
    for (const key of keys) {
      const localPath = await playwrightStoragePath(bucket, key);
      if (localPath) await fs.rm(localPath, { force: true });
    }
    return [];
  }

  const r2Binding = await getR2BucketBinding(bucket);
  if (r2Binding) {
    await r2Binding.delete([...keys]);
    return [];
  }

  let response;
  try {
    response = await getR2Client("single-attempt").send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        // Not quiet: a reply must name every key it deleted.
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: false },
      }),
      r2SendOptions(R2_METADATA_TIMEOUT_MS, options.signal)
    );
  } catch (error) {
    throw asRetryLater(error);
  }
  const requested = new Set(keys);
  const confirmed = new Set<string>();
  const refused = new Set<string>();
  for (const item of response.Deleted ?? []) {
    if (item.Key && requested.has(item.Key)) confirmed.add(item.Key);
  }
  for (const error of response.Errors ?? []) {
    if (!error.Key || !requested.has(error.Key))
      throw new Error("Storage batch reply names a key that was not requested");
    if (error.Code === "NoSuchKey") confirmed.add(error.Key);
    else refused.add(error.Key);
  }
  if (confirmed.size === 0 && refused.size === 0)
    throw new Error("Storage batch reply names none of the requested keys");
  // A key reported both deleted and refused is not confirmed.
  return keys.filter((key) => !confirmed.has(key) || refused.has(key));
}

/**
 * Size of a stored object without downloading it, or null when it is missing.
 * Check this before reading an uploaded object into memory.
 */
export async function getR2ObjectSize(bucket: string, key: string): Promise<number | null> {
  assertSafeStorageKey(key);
  const localPath = await playwrightStoragePath(bucket, key);
  if (localPath) {
    const fs = await import("node:fs/promises");
    try {
      return (await fs.stat(localPath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  const r2Binding = await getR2BucketBinding(bucket);
  if (r2Binding) {
    const object = await r2Binding.head(key);
    return object ? object.size : null;
  }

  const client = getR2Client();
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
      r2SendOptions(R2_METADATA_TIMEOUT_MS)
    );
    return response.ContentLength ?? null;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw error;
  }
}

export async function getR2ObjectBytes(
  bucket: string,
  key: string
): Promise<{ bytes: Uint8Array; contentType?: string; contentLength?: number } | null> {
  assertSafeStorageKey(key);

  const localPath = await playwrightStoragePath(bucket, key);
  if (localPath) {
    const fs = await import("node:fs/promises");
    try {
      const bytes = await fs.readFile(localPath);
      return { bytes, contentLength: bytes.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  const r2Binding = await getR2BucketBinding(bucket);
  if (r2Binding) {
    const object = await r2Binding.get(key);
    if (!object) return null;
    return {
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: object.httpMetadata?.contentType,
      contentLength: object.size,
    };
  }

  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
    r2SendOptions(R2_TRANSFER_TIMEOUT_MS)
  );

  if (!response.Body) {
    return null;
  }

  return {
    bytes: new Uint8Array(await response.Body.transformToByteArray()),
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Generate a presigned URL for secure download from private R2 bucket.
 */
export async function generatePresignedDownloadUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  maxContentLength?: number
): Promise<string> {
  // Clamp expiresIn to safe range: 60s–86400s (1 min–24 hours)
  const safeExpiry = Math.max(60, Math.min(86400, expiresIn));
  const client = getR2Client();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn: safeExpiry });
}

/**
 * Upload an encrypted KYC document to the private R2 bucket.
 * Documents are encrypted before upload for POPIA compliance.
 *
 * @param file - The KYC document file
 * @param ownerId - The account profile ID
 * @param docType - Type of document (e.g., "id_document", "selfie_id", "proof_location")
 * @returns Upload result with key for database storage
 */
export async function uploadKycDocument(
  file: File | Blob,
  ownerId: string,
  docType: string
): Promise<UploadResult> {
  const key = generateStorageKey(`kyc/${docType}`, ownerId, "encrypted.bin");
  return uploadEncryptedEvidenceAtKey(file, ownerId, docType, key);
}

/** Foundation journals own their immutable object key before any bytes move.
 * Encryption stays byte-compatible with existing KYC objects and private reads. */
async function uploadEncryptedEvidenceAtKey(
  file: File | Blob,
  ownerId: string,
  docType: string,
  key: string
): Promise<UploadResult & { storedBytes: number; storedSha256: string }> {
  assertSafeStorageKey(key);
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";

  // Encrypt file before upload
  const encryptedBuffer = await encryptFile(file);

  const { createHash } = await import("node:crypto");
  const receipt = {
    storedBytes: encryptedBuffer.length,
    storedSha256: createHash("sha256").update(encryptedBuffer).digest("hex"),
  };

  // Playwright e2e stub: persist the encrypted artifact on local disk instead
  // of reaching real R2 with fixture credentials (mirrors uploadToR2's stub).
  if (shouldUsePlaywrightStorage()) {
    assertSafeStorageKey(key);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "tmp", "e2e-private-storage");
    const destination = path.join(root, key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, encryptedBuffer);
    return { url: `private://${privateBucket}/${key}`, key, ...receipt };
  }

  // Prefer native R2 binding when running on Cloudflare Workers (no S3 credentials needed).
  const r2Binding = await getR2BucketBinding(privateBucket);
  if (r2Binding) {
    await r2Binding.put(key, encryptedBuffer, {
      customMetadata: { ownerId, docType, encrypted: "true" },
    });
    return { url: `private://${privateBucket}/${key}`, key, ...receipt };
  }

  // Fall back to S3-compatible API (local Next.js dev, or Cloudflare without binding).
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: privateBucket,
    Key: key,
    Body: encryptedBuffer,
    ContentType: "application/octet-stream",
    CacheControl: "private, no-store",
    Metadata: {
      ownerId: ownerId,
      docType: docType,
      encrypted: "true",
    },
  });

  await client.send(command, r2SendOptions(R2_TRANSFER_TIMEOUT_MS));

  return {
    url: `private://${privateBucket}/${key}`, // Use private:// scheme to indicate no public access
    key: key,
    ...receipt,
  };
}

/**
 * Download and decrypt a KYC document from the private R2 bucket.
 * Only for use by authorized admin/reviewer endpoints.
 *
 * @param key - The storage key from database
 * @returns Decrypted file buffer
 */
export async function downloadKycDocument(key: string): Promise<Buffer> {
  const result = await downloadKycDocumentWithMetrics(key);
  return result.buffer;
}

async function downloadKycDocumentWithMetrics(
  key: string
): Promise<{ buffer: Buffer; downloadMs: number; decryptMs: number }> {
  assertSafeStorageKey(key);
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";

  // Route through getR2ObjectBytes so the native R2 binding is preferred when
  // available — binding-only deployments have no S3 credentials configured.
  const downloadStartedAt = Date.now();
  const object = await getR2ObjectBytes(privateBucket, key);

  if (!object) {
    throw new Error("Failed to download KYC document");
  }

  const encryptedBuffer = Buffer.from(object.bytes);
  const downloadMs = Date.now() - downloadStartedAt;

  // Decrypt and return
  const decryptStartedAt = Date.now();
  const buffer = await decryptFile(encryptedBuffer);
  const decryptMs = Date.now() - decryptStartedAt;

  return {
    buffer,
    downloadMs,
    decryptMs,
  };
}
