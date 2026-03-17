/**
 * POST /api/webhooks/kyc/provider
 * Receives asynchronous KYC provider callback events and updates risk/provider state.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";

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

export async function POST(request: NextRequest) {
  try {
    const isProduction = process.env.NODE_ENV === "production";
    const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";

    // ── Webhook signature validation ──────────────────────────
    // When KYC_WEBHOOK_SECRET is set, validate HMAC-SHA256 signature
    // from the X-Webhook-Signature header to prevent spoofed callbacks.
    const webhookSecret = process.env.KYC_WEBHOOK_SECRET;
    let body: Record<string, unknown>;

    if (isProduction && !webhookSecret && !isPlaywrightTestMode) {
      return NextResponse.json({ error: "KYC webhook temporarily unavailable" }, { status: 503 });
    }

    if (webhookSecret) {
      const rawBody = await request.text();
      const signature = request.headers.get("x-webhook-signature");

      if (!signature) {
        return NextResponse.json({ error: "Missing webhook signature" }, { status: 401 });
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
      // No secret configured — accept all (development / stub provider)
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
      }
    }

    // Normalize payload — adapt per-provider format here
    const payload = normalizePayload(body);

    if (!payload || !payload.provider_ref) {
      return NextResponse.json(
        { error: "Missing provider_ref in webhook payload" },
        { status: 400 }
      );
    }

    // In test mode with placeholder Supabase, short-circuit DB calls
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    if (isPlaywrightTestMode && (!supabaseUrl || supabaseUrl.includes("placeholder"))) {
      log.info("Test mode with placeholder Supabase — acknowledging webhook without DB");
      return NextResponse.json({ acknowledged: true, warning: "Test mode — no DB" });
    }

    const adminClient = createAdminClient();

    // Find the provider result by provider_ref
    const { data: providerResult, error: findErr } = await adminClient
      .from("kyc_provider_results")
      .select("id, artifact_id, user_id, provider_status")
      .eq("provider_ref", payload.provider_ref)
      .single();

    if (findErr || !providerResult) {
      log.warn("No provider result found for ref", { providerRef: payload.provider_ref });
      // Return 200 anyway to prevent webhook retries for unknown refs
      return NextResponse.json({
        acknowledged: true,
        warning: "Unknown provider reference",
      });
    }

    // ── Idempotency: skip if this provider result was already finalized ──
    if (
      providerResult.provider_status === payload.status &&
      providerResult.provider_status !== "pending"
    ) {
      return NextResponse.json({
        acknowledged: true,
        duplicate: true,
        provider_result_id: providerResult.id,
      });
    }

    // Update provider result with new data
    const updateData: Record<string, unknown> = {
      provider_status: payload.status,
    };

    if (payload.scores) {
      if (payload.scores.face_match_score !== undefined) {
        updateData.face_match_score = payload.scores.face_match_score;
      }
      if (payload.scores.liveness_score !== undefined) {
        updateData.liveness_score = payload.scores.liveness_score;
      }
      if (payload.scores.doc_auth_score !== undefined) {
        updateData.doc_auth_score = payload.scores.doc_auth_score;
      }
    }

    if (payload.ocr_payload) {
      updateData.ocr_payload = payload.ocr_payload;
    }

    if (payload.raw_response) {
      updateData.raw_response = payload.raw_response;
    }

    await adminClient.from("kyc_provider_results").update(updateData).eq("id", providerResult.id);

    // Recalculate risk on the linked verification step
    const { data: artifact } = await adminClient
      .from("kyc_artifacts")
      .select("step_type")
      .eq("id", providerResult.artifact_id)
      .single();

    if (artifact) {
      // Get all risk signals for this user+step
      const { data: step } = await adminClient
        .from("verification_steps")
        .select("id, status, risk_score")
        .eq("user_id", providerResult.user_id)
        .eq("step_type", artifact.step_type)
        .single();

      if (step) {
        if (step.status !== "pending") {
          log.info("Skipping KYC webhook step update for already-decided step", {
            providerRef: payload.provider_ref,
            stepId: step.id,
            stepStatus: step.status,
          });
        } else {
          // Map provider status to auto_status
          const autoStatus =
            payload.status === "approved"
              ? "approved"
              : payload.status === "rejected"
                ? "rejected"
                : "needs_manual_review";

          // Bump risk score if provider rejected
          let additionalRisk = 0;
          if (payload.status === "rejected") {
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

          await adminClient
            .from("verification_steps")
            .update({
              auto_status: autoStatus,
              risk_score: newRiskScore,
              risk_level: newRiskLevel,
            })
            .eq("id", step.id);
        }
      }
    }

    // Audit log
    await logAuditEvent({
      actorId: "system",
      actorRole: "admin",
      action: "kyc_provider_webhook_received",
      targetType: "kyc_provider_result",
      targetId: providerResult.id,
      metadata: {
        provider_ref: payload.provider_ref,
        status: payload.status,
        user_id: providerResult.user_id,
      },
    });

    return NextResponse.json({
      acknowledged: true,
      provider_result_id: providerResult.id,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Normalize provider-specific payloads to our standard format.
 * Extend this function as real providers are integrated.
 */
function normalizePayload(body: Record<string, unknown>): ProviderWebhookPayload | null {
  const VALID_STATUSES = new Set(["approved", "rejected", "needs_manual_review"]);

  // Direct format (our standard)
  if (body.provider_ref && body.status) {
    if (!VALID_STATUSES.has(body.status as string)) {
      log.warn("Invalid status in payload", { status: body.status });
      return null;
    }
    return body as unknown as ProviderWebhookPayload;
  }

  // SmileID format (example — uncomment when SmileID is integrated)
  // if (body.SmileJobID && body.ResultCode) { ... }

  // Veriff format (example)
  // if (body.verification && body.verification.id) { ... }

  return null;
}
