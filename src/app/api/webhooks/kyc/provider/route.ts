/**
 * POST /api/webhooks/kyc/provider
 * Receives asynchronous KYC provider callback events and updates risk/provider state.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { applyKycProviderWebhook } from "@/lib/services/kyc-webhook-store";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/utils/request-body";
import { isPlaywrightTestMode as checkPlaywrightTestMode } from "@/lib/supabase/playwright-mode";

const log = createLogger("KycWebhook");

/**
 * Expected webhook payload shape (provider-agnostic).
 * Real providers will have different shapes — this is the normalized interface.
 */
interface ProviderWebhookPayload {
  provider_ref: string;
  status: "approved" | "rejected" | "needs_manual_review";
  reason?: string;
  scores?: {
    face_match_score?: number | null;
    liveness_score?: number | null;
    doc_auth_score?: number | null;
  };
  ocr_payload?: Record<string, unknown>;
  raw_response?: Record<string, unknown>;
}

const PROVIDER_STATUSES = ["approved", "rejected", "needs_manual_review"] as const;
const providerScoreSchema = z
  .number({ error: "Score must be a number" })
  .finite("Score must be a number")
  .min(0)
  .max(100);
const providerMetadataSchema = z
  .record(z.string().max(200), z.unknown())
  .superRefine((value, ctx) => {
    const serialized = JSON.stringify(value);
    if (serialized.length > 50_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Payload metadata is too large",
      });
    }
  });
const providerWebhookPayloadSchema = z.object({
  provider_ref: z
    .string()
    .trim()
    .min(1, "Missing provider_ref in webhook payload")
    .max(128, "provider_ref is too long"),
  status: z.enum(PROVIDER_STATUSES, {
    error: "Invalid webhook status",
  }),
  reason: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().max(1_000, "reason is too long").optional()),
  scores: z
    .object({
      face_match_score: providerScoreSchema.optional(),
      liveness_score: providerScoreSchema.optional(),
      doc_auth_score: providerScoreSchema.optional(),
    })
    .strict()
    .optional(),
  ocr_payload: providerMetadataSchema.optional(),
  raw_response: providerMetadataSchema.optional(),
});

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthy(value?: string): boolean {
  return typeof value === "string" && TRUTHY_VALUES.has(value.trim().toLowerCase());
}

function isExplicitLocalUnsignedWebhookBypass(request: NextRequest): boolean {
  const runtimeMode = (process.env.VERIFYMZANSI_RUNTIME_MODE || "").toLowerCase();
  const runtimeIsProduction = runtimeMode === "production";
  return (
    process.env.NODE_ENV === "development" &&
    process.env.ENVIRONMENT !== "production" &&
    !runtimeIsProduction &&
    isTruthy(process.env.ENABLE_DEV_KYC_WEBHOOK_BYPASS) &&
    ["localhost", "127.0.0.1"].includes(request.nextUrl.hostname)
  );
}

function getConfiguredKycProvider(): string {
  return (process.env.KYC_PROVIDER || "stub").trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate limiting ─────────────────────────────────────────
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "webhook:kyc",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const isPlaywrightTestMode = checkPlaywrightTestMode();
    const allowUnsignedWebhook =
      isExplicitLocalUnsignedWebhookBypass(request) || isPlaywrightTestMode;
    const kycProvider = getConfiguredKycProvider();

    if (kycProvider === "stub" && !allowUnsignedWebhook) {
      log.warn("Received provider webhook while KYC_PROVIDER=stub", {
        hostname: request.nextUrl.hostname,
      });
      return NextResponse.json({ error: "KYC provider callbacks are disabled" }, { status: 503 });
    }

    // ── Webhook signature validation ──────────────────────────
    // When KYC_WEBHOOK_SECRET is set, validate HMAC-SHA256 signature
    // from the X-Webhook-Signature header to prevent spoofed callbacks.
    const webhookSecret = process.env.KYC_WEBHOOK_SECRET;
    let body: unknown;

    if (!webhookSecret && !allowUnsignedWebhook) {
      return NextResponse.json({ error: "KYC webhook temporarily unavailable" }, { status: 503 });
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(request, 256 * 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      }
      throw error;
    }
    if (webhookSecret) {
      const signature = request.headers.get("x-webhook-signature");

      if (!signature) {
        return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
      }

      // Validate signature is hex-encoded before comparison
      if (!/^[a-f0-9]{64}$/i.test(signature)) {
        log.warn("Webhook signature is not valid hex encoding");
        return NextResponse.json({ error: "Invalid webhook signature format" }, { status: 401 });
      }

      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      // Use timing-safe comparison to prevent timing attacks
      let isValid = false;
      try {
        isValid = crypto.timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expectedSignature, "hex")
        );
      } catch {
        // timingSafeEqual throws if buffers have different lengths
        isValid = false;
      }

      if (!isValid) {
        log.warn("Invalid webhook signature");
        return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
      }

      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
      }
    } else {
      // Explicitly allowed local/test-only bypass when a webhook secret is not configured.
      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
      }
    }

    // Normalize payload — adapt per-provider format here
    const payload = normalizePayload(body);
    if (!payload) {
      if (isPlainObject(body) && !("provider_ref" in body)) {
        return NextResponse.json(
          { error: "Missing provider_ref in webhook payload" },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const parsedPayload = providerWebhookPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      const providerRefIssue = parsedPayload.error.issues.find(
        (issue) => issue.path[0] === "provider_ref"
      );
      const statusIssue = parsedPayload.error.issues.find((issue) => issue.path[0] === "status");
      const primaryIssue = providerRefIssue ?? statusIssue ?? parsedPayload.error.issues[0];
      return NextResponse.json(
        { error: primaryIssue?.message ?? "Invalid webhook payload" },
        { status: 400 }
      );
    }

    const payloadData = parsedPayload.data;

    // In test mode with placeholder Supabase, short-circuit DB calls
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    if (isPlaywrightTestMode && (!supabaseUrl || supabaseUrl.includes("placeholder"))) {
      log.info("Test mode with placeholder Supabase — acknowledging webhook without DB");
      return NextResponse.json({ acknowledged: true, warning: "Test mode — no DB" });
    }

    const result = await applyKycProviderWebhook(createAdminClient(), payloadData);
    if (result.outcome === "unknown") {
      log.warn("No provider result found for ref", { providerRef: payloadData.provider_ref });
      return NextResponse.json({ acknowledged: true, warning: "Unknown provider reference" });
    }
    return NextResponse.json({
      acknowledged: true,
      provider_result_id: result.provider_result_id,
      ...(result.outcome === "duplicate"
        ? { duplicate: true, skipped_reason: "already_finalized" }
        : {}),
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Normalize provider-specific payloads to our standard format.
 * Extend this function as real providers are integrated.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayload(body: unknown): ProviderWebhookPayload | null {
  if (!isPlainObject(body)) {
    return null;
  }

  // Direct format (our standard)
  if (body.provider_ref && body.status) {
    return body as unknown as ProviderWebhookPayload;
  }

  return null;
}
