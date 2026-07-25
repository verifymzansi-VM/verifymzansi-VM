import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GET /api/health/storage
 *
 * Diagnostic endpoint to check R2 storage access from the Worker runtime.
 * Returns information about which access paths are available.
 * Protected by a dedicated bearer token (HEALTH_DIAGNOSTIC_TOKEN) to avoid
 * leaking internal details. The endpoint is disabled (404) when the token
 * is not configured.
 */
export async function GET(request: Request) {
  // Only allow if correct diagnostic token is present
  const expectedToken = process.env.HEALTH_DIAGNOSTIC_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

  // Timing-safe comparison to prevent token guessing via timing attacks
  let authorized = false;
  try {
    authorized =
      providedToken.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(expectedToken));
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    authorized = false;
  }

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const diagnostics: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    nextRuntime: process.env.NEXT_RUNTIME ?? "unknown",
  };

  // Check 1: process.env S3 credentials
  diagnostics.processEnv = {
    hasAccountId: Boolean(process.env.R2_ACCOUNT_ID),
    hasAccessKey: Boolean(process.env.R2_ACCESS_KEY_ID),
    hasSecretKey: Boolean(process.env.R2_SECRET_ACCESS_KEY),
    r2PrivateBucket: process.env.R2_PRIVATE_BUCKET ?? "not set",
    r2PublicBucket: process.env.R2_PUBLIC_BUCKET ?? "not set",
  };

  // Check 2: globalThis ALS context
  try {
    const contextSymbol = Symbol.for("__cloudflare-context__");
    const context = (globalThis as Record<PropertyKey, unknown>)[contextSymbol] as
      | { env?: Record<string, unknown> }
      | undefined;
    if (context && context.env) {
      const envKeys = Object.keys(context.env);
      const envBindingTypes: Record<string, string> = {};
      for (const key of envKeys) {
        const val = context.env[key];
        envBindingTypes[key] =
          val === null
            ? "null"
            : typeof val === "object"
              ? `object(${Object.keys(val as Record<string, unknown>)
                  .slice(0, 5)
                  .join(",")})`
              : typeof val;
      }
      diagnostics.alsContext = {
        found: true,
        envKeyCount: envKeys.length,
        envBindingTypes,
        hasPrivateBucket: "PRIVATE_BUCKET" in context.env,
        privateBucketType: context.env.PRIVATE_BUCKET
          ? typeof context.env.PRIVATE_BUCKET
          : "undefined",
        hasPublicBucket: "PUBLIC_BUCKET" in context.env,
      };

      // Check if PRIVATE_BUCKET has R2 binding methods
      const pb = context.env.PRIVATE_BUCKET;
      if (pb && typeof pb === "object") {
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(pb)).filter(
          (m) => m !== "constructor"
        );
        diagnostics.privateBucketMethods = methods;
        diagnostics.privateBucketHasPut = typeof (pb as Record<string, unknown>).put === "function";
        diagnostics.privateBucketHasGet = typeof (pb as Record<string, unknown>).get === "function";
        diagnostics.privateBucketHasDelete =
          typeof (pb as Record<string, unknown>).delete === "function";
      }
    } else {
      diagnostics.alsContext = {
        found: false,
        contextExists: Boolean(context),
        contextType: typeof context,
      };
    }
  } catch (err) {
    diagnostics.alsContext = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Check 3: @opennextjs/cloudflare getCloudflareContext
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = await getCloudflareContext({ async: true });
    const env = ctx.env as Record<string, unknown>;
    const envKeys = Object.keys(env);
    diagnostics.openNextContext = {
      found: true,
      envKeyCount: envKeys.length,
      hasPrivateBucket: "PRIVATE_BUCKET" in env,
      hasPublicBucket: "PUBLIC_BUCKET" in env,
      hasR2AccountId: Boolean(env.R2_ACCOUNT_ID),
      hasR2AccessKey: Boolean(env.R2_ACCESS_KEY_ID),
      hasR2SecretKey: Boolean(env.R2_SECRET_ACCESS_KEY),
    };
  } catch (err) {
    diagnostics.openNextContext = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Check 4: hasR2WriteAccess result
  try {
    const { hasR2WriteAccess } = await import("@/lib/services/storage");
    const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
    const hasAccess = await hasR2WriteAccess(privateBucket);
    diagnostics.hasR2WriteAccess = { result: hasAccess, bucket: privateBucket };
  } catch (err) {
    diagnostics.hasR2WriteAccess = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Check 5: Full env validation (triggers Zod schema parse of ALL env vars)
  try {
    const { validateEnv } = await import("@/lib/config/env");
    validateEnv();
    diagnostics.envValidation = { success: true };
  } catch (err) {
    diagnostics.envValidation = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Check 6: Encryption test (same path as uploadKycDocument)
  try {
    const { encryptFile } = await import("@/lib/utils/encryption");
    const testBlob = new Blob(["test-data"], { type: "application/octet-stream" });
    await encryptFile(testBlob);
    diagnostics.encryptionTest = { success: true };
  } catch (err) {
    diagnostics.encryptionTest = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Check 7: Test native R2 put (tiny test file, then delete)
  try {
    const contextSymbol = Symbol.for("__cloudflare-context__");
    const context = (globalThis as Record<PropertyKey, unknown>)[contextSymbol] as
      | { env?: Record<string, unknown> }
      | undefined;
    if (context?.env?.PRIVATE_BUCKET) {
      const binding = context.env.PRIVATE_BUCKET as {
        put: (key: string, value: ArrayBuffer) => Promise<unknown>;
        delete: (key: string) => Promise<void>;
      };
      const testKey = `_diagnostic/test-${Date.now()}.txt`;
      const testData = new TextEncoder().encode("diagnostic-test");
      await binding.put(testKey, testData.buffer as ArrayBuffer);
      await binding.delete(testKey);
      diagnostics.r2PutTest = { success: true, key: testKey };
    } else {
      diagnostics.r2PutTest = { skipped: true, reason: "no native binding" };
    }
  } catch (err) {
    diagnostics.r2PutTest = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json(diagnostics, { status: 200 });
}
