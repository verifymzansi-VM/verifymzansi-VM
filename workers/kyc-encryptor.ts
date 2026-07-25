/**
 * @deprecated — This worker is NO LONGER TRIGGERED by the application.
 *
 * The canonical encryption path is now the inline `uploadKycDocument()` flow
 * in `src/lib/services/storage.ts`, which uses v2 HMAC-SHA256 key derivation
 * from `src/lib/utils/encryption.ts`.
 *
 * This worker remains deployed ONLY to support decryption of files it
 * previously encrypted (using 100k PBKDF2 iteration format). Legacy
 * decryption is handled by `decryptLegacy()` in `src/lib/utils/encryption.ts`.
 *
 * Known bug: the hardcoded `id_document` path (line ~227) is incorrect but
 * will NOT be fixed since no new files are routed through this worker.
 *
 * This worker can be safely undeployed once all v1/worker-encrypted files
 * have been decrypted or purged by the retention-cleanup cron.
 */

/**
 * Legacy Cloudflare Worker that previously handled asynchronous KYC document encryption.
 *
 * Original flow (no longer active):
 * 1. User uploaded document to a temporary R2 bucket using presigned URL.
 * 2. Upload triggered this worker via R2 Event Notification or HTTP trigger.
 * 3. Worker streamed file from temp bucket, encrypted using AES-256-GCM, and piped to private bucket.
 * 4. Worker updated Supabase kyc_artifacts status from 'pending' to 'encrypted'.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Cloudflare Worker type stubs (avoids needing @cloudflare/workers-types in
// the main Next.js tsconfig).
// ---------------------------------------------------------------------------
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string | null,
    options?: R2PutOptions
  ): Promise<R2Object>;
  delete(key: string | string[]): Promise<void>;
}
export interface R2Object {
  key: string;
  size: number;
  httpMetadata?: Record<string, string>;
}
export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2PutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  TEMP_BUCKET: R2Bucket;
  PRIVATE_BUCKET: R2Bucket;
  KYC_ENCRYPTION_KEY: string; // 64-char hex string (32 bytes)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_API_KEY: string; // Shared secret for authenticating callers
}

const legacyEncryptPayloadSchema = z.object({
  tempKey: z
    .string()
    .trim()
    .min(1, "tempKey is required")
    .max(512, "tempKey is too long")
    .regex(/^temp\/kyc\/[A-Za-z0-9/_.,-]+$/, "Invalid tempKey")
    .refine((value) => !value.includes(".."), "Invalid tempKey"),
  sellerId: z.string().trim().min(1, "sellerId is required").max(128, "sellerId is too long"),
  artifactId: z.string().trim().min(1, "artifactId is required").max(128, "artifactId is too long"),
});

/**
 * Parse a hex string into a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time shared-secret comparison. workerd has no node:crypto
 * `timingSafeEqual`, so use a length-normalized XOR loop instead.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLength; i += 1) {
    const aCode = i < a.length ? a.charCodeAt(i) : 0;
    const bCode = i < b.length ? b.charCodeAt(i) : 0;
    diff |= aCode ^ bCode;
  }
  return diff === 0;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Health check endpoint
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          worker: "verifymzansi-kyc-encryptor",
          status: "healthy",
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Authenticate caller via shared secret (constant-time comparison)
    const authHeader = request.headers.get("Authorization");
    const expectedAuthHeader = env.WORKER_API_KEY ? `Bearer ${env.WORKER_API_KEY}` : "";
    if (!expectedAuthHeader || !timingSafeEqual(authHeader ?? "", expectedAuthHeader)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      const parsedPayload = legacyEncryptPayloadSchema.safeParse(payload);
      if (!parsedPayload.success) {
        return new Response(parsedPayload.error.issues[0]?.message ?? "Invalid request body", {
          status: 400,
        });
      }

      const { tempKey: objectKey, sellerId, artifactId } = parsedPayload.data;

      // Defer the heavy encryption process to run after returning 202 to the Next.js API
      ctx.waitUntil(
        this.processEncryption(objectKey, sellerId, artifactId, env).catch(async (err) => {
          console.error(`[KYC Worker] Encryption failed for artifact ${artifactId}:`, err);
          // Mark artifact as failed so the UI can show an error and allow retry
          try {
            await fetch(
              `${env.SUPABASE_URL}/rest/v1/kyc_artifacts?id=eq.${encodeURIComponent(artifactId)}`,
              {
                method: "PATCH",
                headers: {
                  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
                  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                  "Content-Type": "application/json",
                  Prefer: "return=minimal",
                },
                body: JSON.stringify({ status: "encryption_failed" }),
              }
            );
          } catch (patchErr) {
            console.error(`[KYC Worker] Failed to update artifact status:`, patchErr);
          }
        })
      );

      return new Response(JSON.stringify({ success: true, status: "processing" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e: unknown) {
      // Do not leak internal error detail to callers — keep it in the logs.
      console.error("[KYC Worker] Unhandled error:", e);
      return new Response("Internal server error", { status: 500 });
    }
  },

  async processEncryption(tempKey: string, sellerId: string, artifactId: string, env: Env) {
    console.warn(`[KYC Worker] Starting encryption for artifact ${artifactId}`);

    // ── Constants matching src/lib/utils/encryption.ts ──────────
    const SALT_LENGTH = 64;
    const IV_LENGTH = 12; // NIST-recommended for AES-GCM
    const TAG_LENGTH = 16; // AES-GCM auth tag size (128 bits)
    const KEY_LENGTH = 32; // AES-256
    const ITERATIONS = 100000;

    // Fetch file from temp bucket
    const fileObj = await env.TEMP_BUCKET.get(tempKey);
    if (!fileObj) throw new Error("File not found in temp bucket");

    // Guard against excessively large files to prevent OOM
    const MAX_KYC_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
    if (fileObj.size > MAX_KYC_FILE_SIZE) {
      throw new Error(`File too large: ${fileObj.size} bytes (max ${MAX_KYC_FILE_SIZE})`);
    }

    // Read plaintext file data
    const rawData = await fileObj.arrayBuffer();

    // Import master key from hex env var
    const masterKeyBytes = hexToBytes(env.KYC_ENCRYPTION_KEY);

    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    // Derive encryption key using PBKDF2 (matches Node.js crypto.pbkdf2Sync)
    const masterKey = await crypto.subtle.importKey(
      "raw",
      masterKeyBytes as unknown as BufferSource,
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt as unknown as BufferSource,
        iterations: ITERATIONS,
        hash: "SHA-512", // matches Node.js "sha512"
      },
      masterKey,
      KEY_LENGTH * 8 // bits
    );

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      derivedBits,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    // Encrypt using AES-256-GCM
    const ciphertextWithTag = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource, tagLength: TAG_LENGTH * 8 },
      cryptoKey,
      rawData
    );

    // Web Crypto appends auth tag to ciphertext; split them to match
    // Node.js format: [salt][iv][tag][ciphertext]
    const ctBytes = new Uint8Array(ciphertextWithTag);
    const ciphertext = ctBytes.slice(0, ctBytes.length - TAG_LENGTH);
    const tag = ctBytes.slice(ctBytes.length - TAG_LENGTH);

    // Assemble final buffer: [64-byte salt][12-byte IV][16-byte tag][ciphertext]
    const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + TAG_LENGTH + ciphertext.length);
    combined.set(salt, 0);
    combined.set(iv, SALT_LENGTH);
    combined.set(tag, SALT_LENGTH + IV_LENGTH);
    combined.set(ciphertext, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    // Copy into a clean ArrayBuffer to avoid SharedArrayBuffer type issues
    const encryptedData = combined.buffer.slice(
      combined.byteOffset,
      combined.byteOffset + combined.byteLength
    ) as ArrayBuffer;

    const finalKey = `kyc/id_document/${sellerId}/${Date.now()}-encrypted.bin`;

    // Save to private bucket with key version for future rotation support
    await env.PRIVATE_BUCKET.put(finalKey, encryptedData, {
      httpMetadata: fileObj.httpMetadata,
      customMetadata: { encrypted: "true", sellerId, key_version: "1" },
    });

    // Delete temp file to avoid storage bloat
    await env.TEMP_BUCKET.delete(tempKey);

    // Update Supabase to mark ready — URL-encode artifactId to prevent filter injection
    const patchResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/kyc_artifacts?id=eq.${encodeURIComponent(artifactId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ r2_key: finalKey, status: "encrypted" }),
      }
    );

    // A failed status update must surface as an error so the caller's
    // retry / encryption_failed path runs instead of silently dropping it.
    if (!patchResponse.ok) {
      throw new Error(
        `Failed to mark artifact ${artifactId} as encrypted: HTTP ${patchResponse.status}`
      );
    }

    console.warn(`[KYC Worker] Processing complete for ${artifactId}`);
  },
};

export default worker;
