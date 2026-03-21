import { NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminVerificationDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { getStaffActorRole } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createNotification } from "@/lib/notifications";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("AdminVerification");

/**
 * POST /api/admin/verification/decide
 * Process a KYC verification step decision (approve/reject/needs_resubmission).
 */
export async function POST(request: Request) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminRole = getStaffActorRole(user);
    if (!adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:verification:decide");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = adminVerificationDecideSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { stepId, decision, reasonCode, reasonNote, overrideReasonCode } = parsed.data;

    const admin = createAdminClient();

    // Get the verification step
    const { data: step, error: stepError } = await admin
      .from("verification_steps")
      .select("*")
      .eq("id", stepId)
      .single();

    if (stepError || !step) {
      return NextResponse.json({ error: "Verification step not found" }, { status: 404 });
    }

    // If approving a high/critical risk step, override reason is required
    if (
      decision === "approved" &&
      (step.risk_level === "high" || step.risk_level === "critical") &&
      !overrideReasonCode
    ) {
      return NextResponse.json(
        { error: "Override reason code is required when approving high-risk steps" },
        { status: 400 }
      );
    }

    // Update the verification step
    const updateData: Record<string, unknown> = {
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    };

    if (decision !== "approved") {
      updateData.reason_code = reasonCode;
      updateData.reason_note = reasonNote || null;
    }

    if (overrideReasonCode) {
      updateData.override_reason_code = overrideReasonCode;
    }

    // CAS guard: only update steps that are still in a reviewable state.
    // Prevents two admins from overwriting each other's decisions.
    const { data: updatedRows, error: updateError } = await admin
      .from("verification_steps")
      .update(updateData)
      .eq("id", stepId)
      .in("status", ["pending", "needs_resubmission"])
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: "Failed to update verification step" }, { status: 500 });
    }

    if (!updatedRows?.length) {
      return NextResponse.json(
        { error: "Step already reviewed or no longer in a reviewable state" },
        { status: 409 }
      );
    }

    // Sync the latest artifact status to match the step decision.
    // NOTE: PostgREST ignores .order()/.limit() on UPDATE, so we SELECT
    // the latest artifact first, then update by its specific ID.
    const artifactStatus =
      decision === "approved"
        ? "approved"
        : decision === "needs_resubmission"
          ? "needs_resubmission"
          : "rejected";

    const { data: latestArtifact } = await admin
      .from("kyc_artifacts")
      .select("id")
      .eq("user_id", step.user_id)
      .eq("step_type", step.step_type)
      .in("status", ["pending", "needs_resubmission"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestArtifact) {
      const { error: artifactSyncError } = await admin
        .from("kyc_artifacts")
        .update({ status: artifactStatus })
        .eq("id", latestArtifact.id);

      if (artifactSyncError) {
        log.warn("Failed to sync artifact status (non-fatal)", {
          error: artifactSyncError.message,
          stepId,
          decision,
        });
      }
    }

    // If approved, check if all 4 steps are now approved → update the account to verified
    if (decision === "approved") {
      const { data: allSteps } = await admin
        .from("verification_steps")
        .select("step_type, status")
        .eq("user_id", step.user_id);

      const approvedSteps = (allSteps || []).filter((s) => s.status === "approved");
      const requiredSteps = ["phone", "id_doc", "selfie", "location"];
      const allApproved = requiredSteps.every((reqStep) =>
        approvedSteps.some((s) => s.step_type === reqStep)
      );

      if (allApproved) {
        await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update({
            account_verification_status: "verified",
          })
          .eq("user_id", step.user_id);

        // Set purge_after = NOW + 30 days on all KYC artifacts for this user
        const purgeAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const { error: purgeErr } = await admin
          .from("kyc_artifacts")
          .update({ purge_after: purgeAfter })
          .eq("user_id", step.user_id)
          .is("purge_after", null);

        if (purgeErr) {
          log.error("Failed to schedule KYC artifact purge", {
            userId: step.user_id,
            error: purgeErr.message,
          });
        } else {
          await logAuditEvent({
            actorId: user.id,
            actorRole: adminRole,
            action: "kyc_purge_scheduled",
            targetType: "account_profile",
            targetId: step.user_id,
            metadata: {
              purge_after: purgeAfter,
              step_count: approvedSteps.length,
              owner_user_id: step.user_id,
            },
          });
        }
      } else {
        await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update({
            account_verification_status: "pending_review",
          })
          .eq("user_id", step.user_id)
          .in("account_verification_status", ["incomplete", "pending_review", "rejected"]);
      }
    } else if (decision === "rejected") {
      // Include "verified" so that rejecting a step on a verified account
      // properly downgrades the account status (prevents verified + rejected step desync).
      await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_verification_status: "rejected",
        })
        .eq("user_id", step.user_id)
        .in("account_verification_status", [
          "incomplete",
          "pending_review",
          "rejected",
          "verified",
        ]);
    } else {
      // needs_resubmission — keep as pending_review so the user isn't shown "rejected".
      // Include "verified" so re-review of a step on a verified account is handled.
      await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_verification_status: "pending_review",
        })
        .eq("user_id", step.user_id)
        .in("account_verification_status", [
          "incomplete",
          "pending_review",
          "rejected",
          "verified",
        ]);
    }

    // Log audit event
    const auditAction =
      decision === "approved"
        ? "verification_approved"
        : decision === "needs_resubmission"
          ? "verification_resubmission_requested"
          : "verification_rejected";

    await logAuditEvent({
      actorId: user.id,
      actorRole: adminRole,
      action: auditAction as
        | "verification_approved"
        | "verification_rejected"
        | "verification_resubmission_requested",
      targetType: "verification_step",
      targetId: stepId,
      metadata: {
        step_type: step.step_type,
        decision,
        reasonCode,
        reasonNote,
        overrideReasonCode,
        risk_level: step.risk_level,
        risk_score: step.risk_score,
        owner_user_id: step.user_id,
      },
    });

    // Notify the account holder about the verification decision
    try {
      const stepLabel =
        step.step_type === "id_doc"
          ? "ID Document"
          : step.step_type === "selfie"
            ? "Selfie"
            : step.step_type === "location"
              ? "Location"
              : step.step_type === "phone"
                ? "Phone"
                : step.step_type;
      // Lowercase label for inline use — preserves "ID" casing
      const stepLabelInline = step.step_type === "id_doc" ? "ID document" : stepLabel.toLowerCase();

      if (decision === "approved") {
        await createNotification({
          userId: step.user_id,
          type: "success",
          title: `${stepLabel} verification approved`,
          message: `Your ${stepLabelInline} verification step has been approved.`,
          href: "/verification",
        });
      } else if (decision === "needs_resubmission") {
        await createNotification({
          userId: step.user_id,
          type: "warning",
          title: `${stepLabel} needs resubmission`,
          message: reasonNote
            ? `Please resubmit your ${stepLabelInline}: ${reasonNote.slice(0, 80)}`
            : `Please resubmit your ${stepLabelInline} verification.`,
          href: "/verification",
        });
      } else {
        await createNotification({
          userId: step.user_id,
          type: "error",
          title: `${stepLabel} verification rejected`,
          message: reasonNote
            ? reasonNote.slice(0, 100)
            : `Your ${stepLabelInline} verification was not accepted.`,
          href: "/verification",
        });
      }
    } catch (notifErr) {
      log.warn("Failed to send notification (non-fatal)", {
        error: notifErr instanceof Error ? notifErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true, decision });
  } catch (err) {
    log.error("Verification decide failed", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
