/**
 * POST /api/webhooks/kyc/provider
 * Receives asynchronous KYC provider callback events and updates risk/provider state.
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import {
  findProviderResultByRef,
  getArtifactStepType,
  getVerificationStepForUserAndType,
  updateProviderResult,
  updateVerificationStepRiskDecision,
} from "@/lib/services/kyc-webhook-store";
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
    !runtimeIsProduction &&
    isTruthy(process.env.ENABLE_DEV_KYC_WEBHOOK_BYPASS) &&
    ["localhost", "127.0.0.1"].includes(request.nextUrl.hostname)
  );
}

export async function POST(request: NextRequest) {
  try {
    const isPlaywrightTestMode = checkPlaywrightTestMode();
    const allowUnsignedWebhook =
      isExplicitLocalUnsignedWebhookBypass(request) || isPlaywrightTestMode;

    // ── Webhook signature validation ──────────────────────────
    // When KYC_WEBHOOK_SECRET is set, validate HMAC-SHA256 signature
    // from the X-Webhook-Signature header to prevent spoofed callbacks.
    const webhookSecret = process.env.KYC_WEBHOOK_SECRET;
    let body: unknown;

    if (!webhookSecret && !allowUnsignedWebhook) {
      return NextResponse.json({ error: "KYC webhook temporarily unavailable" }, { status: 503 });
    }

    if (webhookSecret) {
      const rawBody = await request.text();
      const signature = request.headers.get("x-webhook-signature");

      if (!signature) {
        return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
      }

      // Validate signature is hex-encoded before comparison
      if (!/^[a-f0-9]+$/i.test(signature)) {
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
        body = await request.json();
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

    const adminClient = createAdminClient();
    const providerResult = await findProviderResultByRef(
      adminClient as never,
      payloadData.provider_ref
    );

    if (!providerResult) {
      log.warn("No provider result found for ref", { providerRef: payloadData.provider_ref });
      // Return 200 anyway to prevent webhook retries for unknown refs
      return NextResponse.json({
        acknowledged: true,
        warning: "Unknown provider reference",
      });
    }

    // ── Idempotency: skip if this provider result was already processed with this status ──
    // Uses a combination of checks:
    // 1. If the status has already been set (not pending), check if this is the same final status
    // 2. Additionally verify no update was recently made to prevent rapid duplicate processing
    const alreadyFinalized =
      providerResult.provider_status !== "pending" &&
      providerResult.provider_status === payloadData.status;
    const recentlyUpdated =
      providerResult.updated_at &&
      new Date().getTime() - new Date(providerResult.updated_at).getTime() < 2000;

    if (alreadyFinalized || recentlyUpdated) {
      log.info("Skipping webhook processing — already finalized or recently updated", {
        providerRef: payloadData.provider_ref,
        alreadyFinalized,
        recentlyUpdated,
      });
      return NextResponse.json({
        acknowledged: true,
        duplicate: true,
        skipped_reason: alreadyFinalized ? "already_finalized" : "recently_updated",
        provider_result_id: providerResult.id,
      });
    }

    // Update provider result with new data
    const updateData: Record<string, unknown> = {
      provider_status: payloadData.status,
    };

    if (payloadData.scores) {
      if (payloadData.scores.face_match_score !== undefined) {
        updateData.face_match_score = payloadData.scores.face_match_score;
      }
      if (payloadData.scores.liveness_score !== undefined) {
        updateData.liveness_score = payloadData.scores.liveness_score;
      }
      if (payloadData.scores.doc_auth_score !== undefined) {
        updateData.doc_auth_score = payloadData.scores.doc_auth_score;
      }
    }

    if (payloadData.ocr_payload) {
      updateData.ocr_payload = payloadData.ocr_payload;
    }

    if (payloadData.raw_response) {
      updateData.raw_response = payloadData.raw_response;
    }

    await updateProviderResult(adminClient as never, providerResult.id, updateData);

    // Recalculate risk on the linked verification step
    const artifactStepType = await getArtifactStepType(
      adminClient as never,
      providerResult.artifact_id
    );

    if (artifactStepType) {
      // Get all risk signals for this user+step
      const step = await getVerificationStepForUserAndType(
        adminClient as never,
        providerResult.user_id,
        artifactStepType
      );

      if (step) {
        if (step.status !== "pending") {
          log.info("Skipping KYC webhook step update for already-decided step", {
            providerRef: payloadData.provider_ref,
            stepId: step.id,
            stepStatus: step.status,
          });
        } else {
          // Map provider status to auto_status
          const autoStatus =
            payloadData.status === "approved"
              ? "approved"
              : payloadData.status === "rejected"
                ? "rejected"
                : "needs_manual_review";

          // Bump risk score if provider rejected
          let additionalRisk = 0;
          if (payloadData.status === "rejected") {
            additionalRisk = 30;
          }

          const newRiskScore = Math.min((step.risk_score || 0) + additionalRisk, 100);
          const newRiskLevel =
            newRiskScore <= 25
              ? "low"
              : newRiskScore <= 50
                ? "medium"
                : newRiskScore <= 75
                  ? "high"
                  : "critical";

          await updateVerificationStepRiskDecision(adminClient as never, step.id, {
            auto_status: autoStatus,
            risk_score: newRiskScore,
            risk_level: newRiskLevel,
          });
        }
      }
    }

    // Audit log
    await logAuditEvent({
      actorId: "system",
      actorRole: "system",
      action: "kyc_provider_webhook_received",
      targetType: "kyc_provider_result",
      targetId: providerResult.id,
      metadata: {
        provider_ref: payloadData.provider_ref,
        status: payloadData.status,
        user_id: providerResult.user_id,
      },
    });

    return NextResponse.json({
      acknowledged: true,
      provider_result_id: providerResult.id,
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

  // SmileID format (example — uncomment when SmileID is integrated)
  // if (body.SmileJobID && body.ResultCode) { ... }

  // Veriff format (example)
  // if (body.verification && body.verification.id) { ... }

  return null;
}
