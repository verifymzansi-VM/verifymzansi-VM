/**
 * POST /api/verification/session/start
 * Starts or resumes a verification session and returns step requirements.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { logAuditEvent } from "@/lib/services/audit";
import { REQUIRED_VERIFICATION_STEPS } from "@/lib/constants/verification";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("SessionStart");

export async function POST(_request: NextRequest) {
  try {
    const request = _request;
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Email confirmation gate — users must confirm their email before starting verification
    if (!user.email_confirmed_at) {
      return NextResponse.json(
        { error: "Please confirm your email address before starting verification" },
        { status: 403 }
      );
    }

    const rateCheck = await checkRateLimit({
      key: user.id,
      action: "verification:session-start",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return NextResponse.json(
          {
            error: "Verification session protection is temporarily unavailable. Please try again.",
          },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return NextResponse.json(
        { error: "Too many verification session attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // Feature flag check
    const v2Enabled = await isFeatureEnabled("kyc_v2_flow");
    if (!v2Enabled) {
      return NextResponse.json(
        { error: "New verification flow is not yet enabled" },
        { status: 404 }
      );
    }

    // Fetch the most recent non-finalized verification session
    const { data: existingSession } = await supabase
      .from("verification_sessions")
      .select("*")
      .eq("user_id", user.id)
      .is("finalized_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let session = existingSession;

    // If the existing session is expired, reset it for reuse (UNIQUE(user_id) allows only one row)
    if (session) {
      const expiresAt = new Date(new Date(session.created_at).getTime() + 24 * 60 * 60 * 1000);
      if (expiresAt < new Date()) {
        // Check if phone was already verified in verification_steps
        const { data: phoneStep } = await supabase
          .from("verification_steps")
          .select("phone_verified_at")
          .eq("user_id", user.id)
          .eq("step_type", "phone")
          .in("status", ["approved", "pending"])
          .maybeSingle();

        // Reset the expired session in-place instead of finalize + insert
        // (inserting would violate the UNIQUE(user_id) constraint)
        const { data: resetSession, error: resetErr } = await supabase
          .from("verification_sessions")
          .update({
            finalized_at: null,
            created_at: new Date().toISOString(),
            phone_verified_at: phoneStep?.phone_verified_at ?? null,
            id_artifact_id: null,
            selfie_artifact_id: null,
            location_submitted_at: null,
          })
          .eq("id", session.id)
          .select()
          .single();

        if (resetErr || !resetSession) {
          log.error("Failed to reset expired session", { error: resetErr?.message ?? "unknown" });
          return NextResponse.json(
            { error: "Failed to create verification session" },
            { status: 500 }
          );
        }

        session = resetSession;

        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: "kyc_session_started",
          targetType: "verification_session",
          targetId: session.id,
        });
      }
    }

    if (!session) {
      // Check if phone was already verified in verification_steps
      const { data: phoneStep } = await supabase
        .from("verification_steps")
        .select("phone_verified_at")
        .eq("user_id", user.id)
        .eq("step_type", "phone")
        .in("status", ["approved", "pending"])
        .maybeSingle();

      // Use upsert to handle edge case where a finalized row already exists
      const { data: newSession, error: insertErr } = await supabase
        .from("verification_sessions")
        .upsert(
          {
            user_id: user.id,
            finalized_at: null,
            phone_verified_at: phoneStep?.phone_verified_at ?? null,
            id_artifact_id: null,
            selfie_artifact_id: null,
            location_submitted_at: null,
          },
          { onConflict: "user_id" }
        )
        .select()
        .single();

      if (insertErr || !newSession) {
        log.error("Failed to create session", { error: insertErr?.message ?? "unknown" });
        return NextResponse.json(
          { error: "Failed to create verification session" },
          { status: 500 }
        );
      }

      session = newSession;

      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "kyc_session_started",
        targetType: "verification_session",
        targetId: session.id,
      });
    }

    // Fetch all existing verification steps for this user
    const { data: steps } = await supabase
      .from("verification_steps")
      .select("step_type, status")
      .eq("user_id", user.id);

    const completedSteps: string[] = [];
    const pendingSteps: string[] = [];
    const rejectedSteps: string[] = [];

    for (const step of steps || []) {
      if (step.status === "approved") {
        completedSteps.push(step.step_type);
      } else if (step.status === "pending") {
        pendingSteps.push(step.step_type);
      } else if (step.status === "rejected" || step.status === "needs_resubmission") {
        rejectedSteps.push(step.step_type);
      }
    }

    // Calculate session expiry (24h from start)
    const expiresAt = new Date(
      new Date(session.created_at).getTime() + 24 * 60 * 60 * 1000
    ).toISOString();

    return NextResponse.json({
      sessionId: session.id,
      completedSteps,
      pendingSteps,
      rejectedSteps,
      requiredSteps: [...REQUIRED_VERIFICATION_STEPS],
      expiresAt,
      phoneVerifiedAt: session.phone_verified_at,
      idArtifactId: session.id_artifact_id,
      selfieArtifactId: session.selfie_artifact_id,
      locationSubmittedAt: session.location_submitted_at,
      finalizedAt: session.finalized_at,
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
