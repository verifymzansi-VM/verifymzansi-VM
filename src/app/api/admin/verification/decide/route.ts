import { NextResponse } from "next/server";
import {
  parseAndValidateJsonRequest,
  unauthorizedResponse,
  forbiddenResponse,
  rateLimitResponse,
} from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminVerificationDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit, checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { applyVerificationDecision, isHighRiskStep } from "@/lib/services/verification-decision";
import { decisionRefusalResponse } from "@/lib/services/decision-ledger";

const log = createLogger("AdminVerification");
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };

/**
 * POST /api/admin/verification/decide
 *
 * Decide a KYC verification step (approve / reject / needs_resubmission).
 * Approving a high- or critical-risk step is an override: it is proposed
 * here and applied only when another governor or admin approves it on the
 * escalations page. Nobody decides their own verification.
 */
export async function POST(request: Request) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return unauthorizedResponse();

    const actorRole = await verifyStaffActorRoleFromDb(user);
    if (!actorRole) return forbiddenResponse();

    const mfaBlock = await checkStaffApiMfa(supabase, user.id);
    if (mfaBlock) return mfaBlock;

    const rl = checkLocalRateLimit(user.id, "admin:verification:decide");
    if (rl.limited) return rateLimitResponse(rl.retryAfter ?? 60);

    const bodyResult = await parseAndValidateJsonRequest(request, adminVerificationDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) return bodyResult.response;

    const { stepId, decision, reasonCode, reasonNote, overrideReasonCode } = bodyResult.data;
    const admin = createAdminClient();

    const { data: step, error: stepError } = await admin
      .from("verification_steps")
      .select("*")
      .eq("id", stepId)
      .single();
    if (stepError || !step) {
      return NextResponse.json({ error: "Verification step not found" }, { status: 404 });
    }

    if (step.user_id === user.id) {
      return NextResponse.json(
        { error: "Someone else must review your own verification.", code: "not_independent" },
        { status: 403 }
      );
    }

    if (decision === "approved" && isHighRiskStep(step)) {
      if (!overrideReasonCode) {
        return NextResponse.json(
          { error: "Override reason code is required when approving high-risk steps" },
          { status: 400 }
        );
      }

      // Proposing an override is sensitive: recent second factor, and fail
      // closed without the shared limiter.
      const stepUpBlock = await checkStaffApiMfa(supabase, user.id, { stepUp: true });
      if (stepUpBlock) return stepUpBlock;
      const overrideRl = await checkSensitiveActionRateLimit(
        user.id,
        "admin:verification:override"
      );
      if (overrideRl.limited) return rateLimitResponse(overrideRl.retryAfter ?? 60);

      const { data, error } = await admin.rpc("propose_kyc_override", {
        p_actor: user.id,
        p_step: step.id,
        p_user: step.user_id,
        p_risk_level: step.risk_level,
        p_override_reason: overrideReasonCode,
        p_note: reasonNote ?? null,
      });
      if (error) {
        log.error("KYC override proposal failed", { stepId, error: error.message });
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500, headers: NO_STORE }
        );
      }
      const result = data as { ok: boolean; error?: string; decision_id?: string };
      if (!result.ok) {
        return result.error === "pending_exists"
          ? NextResponse.json(
              {
                error: "An override for this step is already waiting for approval.",
                code: "pending_exists",
              },
              { status: 409 }
            )
          : decisionRefusalResponse(result.error ?? "forbidden");
      }
      return NextResponse.json(
        {
          success: true,
          decision,
          status: "proposed",
          decisionId: result.decision_id,
          message: "High-risk approval sent for a second reviewer to confirm.",
        },
        { status: 202, headers: NO_STORE }
      );
    }

    const applied = await applyVerificationDecision({
      step,
      decision,
      reasonCode,
      reasonNote,
      overrideReasonCode,
      reviewerId: user.id,
      reviewerRole: actorRole,
    });
    if (!applied.ok) {
      return NextResponse.json(
        { error: applied.error, ...(applied.code ? { code: applied.code } : {}) },
        { status: applied.status }
      );
    }

    return NextResponse.json({ success: true, decision }, { headers: NO_STORE });
  } catch (err) {
    log.error("Verification decide failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
