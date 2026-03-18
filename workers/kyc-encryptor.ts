/**
 * Background Cloudflare Worker for asynchronously encrypting KYC documents.
 *
 * 1. User uploads document to a temporary R2 bucket using presigned URL.
 * 2. Upload triggers this worker via R2 Event Notification or HTTP trigger.
 * 3. Worker streams file from temp bucket, encrypts using AES-256-GCM, and pipes to private bucket.
 * 4. Worker updates Supabase kyc_artifacts status from 'pending' to 'encrypted'.
 */

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
  /** Previous encryption key kept during rotation so old blobs stay readable. */
  KYC_ENCRYPTION_KEY_PREVIOUS?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_API_KEY: string; // Shared secret for authenticating callers
}

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

    // Authenticate caller via shared secret
    const authHeader = request.headers.get("Authorization");
    if (!env.WORKER_API_KEY || authHeader !== `Bearer ${env.WORKER_API_KEY}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const payload = (await request.json()) as {
        tempKey?: string;
        sellerId?: string;
        artifactId?: string;
      };
      const objectKey = payload.tempKey;
      const sellerId = payload.sellerId;
      const artifactId = payload.artifactId;

      if (!objectKey || !sellerId || !artifactId) {
        return new Response("Missing required fields", { status: 400 });
      }

      // Validate tempKey prefix to prevent arbitrary R2 file access
      if (!objectKey.startsWith("temp/kyc/") || objectKey.includes("..")) {
        return new Response("Invalid tempKey", { status: 400 });
      }

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
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(message, { status: 500 });
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
        body: JSON.stringify({ r2_key: finalKey, status: "encrypted" }),
      }
    );

    console.warn(`[KYC Worker] Processing complete for ${artifactId}`);
  },
};

export default worker;
