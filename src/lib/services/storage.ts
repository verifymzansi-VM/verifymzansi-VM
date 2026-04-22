import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { encryptFile, decryptFile } from "@/lib/utils/encryption";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Storage");

/**
 * R2-compatible object storage helpers for listing images
 * and verification documents.
 */

/**
 * Minimal R2Bucket interface matching the Cloudflare Workers R2 binding API.
 * Full types are in @cloudflare/workers-types but that package is not installed.
 */
interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  get(
    key: string,
    options?: Record<string, unknown>
  ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

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
 */
let _r2Client: S3Client | null = null;
let _r2ConfigKey: string | null = null;

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  // Invalidate singleton if credentials change (e.g. key rotation).
  const configKey = `${accountId}:${accessKeyId}`;
  if (_r2Client && _r2ConfigKey === configKey) {
    return _r2Client;
  }

  _r2Client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  _r2ConfigKey = configKey;
  return _r2Client;
}

/**
 * Upload a file to Cloudflare R2 using AWS S3-compatible SDK.
 * This properly signs requests using AWS Sigv4.
 */
export async function uploadToR2(params: UploadParams): Promise<UploadResult> {
  if (process.env.PLAYWRIGHT_TEST_MODE === "1" && process.env.PLAYWRIGHT_SUPABASE_MODE === "stub") {
    assertSafeStorageKey(params.key);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const arrayBuffer = await params.file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const publicRoot = path.join(process.cwd(), "public", "e2e-media");
    const destination = path.join(publicRoot, params.key);

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "";
    const normalizedKey = params.key.replace(/\\/g, "/");
    const url = appUrl ? `${appUrl}/e2e-media/${normalizedKey}` : `/e2e-media/${normalizedKey}`;

    return { url, key: normalizedKey };
  }

  const client = getR2Client();
  const arrayBuffer = await params.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const command = new PutObjectCommand({
    Bucket: params.bucket,
    Key: params.key,
    Body: buffer,
    ContentType: params.contentType,
  });

  await client.send(command);

  // Generate public URL (trim trailing slash from base to avoid double-slash)
  const publicUrl = process.env.R2_PUBLIC_URL
    ? `${process.env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${params.key}`
    : `https://${params.bucket}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${params.key}`;

  return { url: publicUrl, key: params.key };
}

/**
 * Generate a unique key for uploaded files.
 */
export function generateStorageKey(prefix: string, ownerId: string, filename: string): string {
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
  const ext = (filename.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "");
  const timestamp = Date.now();
  const random = globalThis.crypto.randomUUID().slice(0, 8);
  return `${safePrefix}/${safeOwnerId}/${timestamp}-${random}.${ext}`;
}

/**
 * Delete a file from R2.
 */
export async function deleteFromR2(bucket: string, key: string): Promise<void> {
  assertSafeStorageKey(key);

  // Prefer native R2 binding when running on Cloudflare Workers.
  const r2Binding = await getR2BucketBinding(bucket);
  if (r2Binding) {
    await r2Binding.delete(key);
    return;
  }

  const client = getR2Client();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);
}

/**
 * Generate a presigned URL for direct client-side upload to R2.
 * This allows users to upload files directly without proxying through the server.
 */
export async function generatePresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number = 3600,
  maxContentLength?: number
): Promise<string> {
  // Clamp expiresIn to safe range: 60s–86400s (1 min–24 hours)
  const safeExpiry = Math.max(60, Math.min(86400, expiresIn));
  const client = getR2Client();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(maxContentLength != null ? { ContentLength: maxContentLength } : {}),
  });

  return await getSignedUrl(client, command, { expiresIn: safeExpiry });
}

/**
 * Generate a presigned URL for secure download from private R2 bucket.
 */
export async function generatePresignedDownloadUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600
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
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";

  // Encrypt file before upload
  const encryptedBuffer = await encryptFile(file);

  // Generate storage key
  const key = generateStorageKey(`kyc/${docType}`, ownerId, "encrypted.bin");

  // Prefer native R2 binding when running on Cloudflare Workers (no S3 credentials needed).
  const r2Binding = await getR2BucketBinding(privateBucket);
  if (r2Binding) {
    await r2Binding.put(key, encryptedBuffer, {
      customMetadata: { ownerId, docType, encrypted: "true" },
    });
    return { url: `private://${privateBucket}/${key}`, key };
  }

  // Fall back to S3-compatible API (local Next.js dev, or Cloudflare without binding).
  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: privateBucket,
    Key: key,
    Body: encryptedBuffer,
    ContentType: "application/octet-stream",
    Metadata: {
      ownerId: ownerId,
      docType: docType,
      encrypted: "true",
    },
  });

  await client.send(command);

  return {
    url: `private://${privateBucket}/${key}`, // Use private:// scheme to indicate no public access
    key: key,
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

export async function downloadKycDocumentWithMetrics(
  key: string
): Promise<{ buffer: Buffer; downloadMs: number; decryptMs: number }> {
  assertSafeStorageKey(key);
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";

  const client = getR2Client();
  const command = new GetObjectCommand({
    Bucket: privateBucket,
    Key: key,
  });

  const downloadStartedAt = Date.now();
  const response = await client.send(command);

  if (!response.Body) {
    throw new Error("Failed to download KYC document");
  }

  // Use the SDK's portable helper to convert stream to byte array
  const encryptedBuffer = Buffer.from(await response.Body.transformToByteArray());
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

/**
 * Generate a temporary presigned URL for admin to view encrypted KYC document.
 * The URL expires quickly and requires decryption client-side or via API.
 *
 * @param key - The storage key from database
 * @param expiresIn - Expiry time in seconds (default: 15 minutes for security)
 * @returns Presigned download URL
 */
export async function getKycDocumentViewUrl(key: string, expiresIn: number = 900): Promise<string> {
  assertSafeStorageKey(key);
  const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
  return generatePresignedDownloadUrl(privateBucket, key, expiresIn);
}
