import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminVerificationDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createNotification } from "@/lib/notifications";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import {
  sendVerificationApprovedEmail,
  sendVerificationRejectedEmail,
  sendVerificationResubmissionEmail,
} from "@/lib/services/email";

const log = createLogger("AdminVerification");

/**
 * POST /api/admin/verification/decide
 * Process a KYC verification step decision (approve/reject/needs_resubmission).
 */
export async function POST(request: Request) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminRole = await verifyStaffActorRoleFromDb(user);
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

    const bodyResult = await parseAndValidateJsonRequest(request, adminVerificationDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { stepId, decision, reasonCode, reasonNote, overrideReasonCode } = bodyResult.data;

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
      decided_at: new Date().toISOString(),
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
        // ── Propagate legal name from id_doc step → seller_profiles ──
        const idDocStep = (allSteps || []).find(
          (s) => s.step_type === "id_doc" && s.status === "approved"
        );

        const legalNamePatch: Record<string, unknown> = {
          account_verification_status: "verified",
        };

        if (idDocStep) {
          // Fetch first_name / last_name from the id_doc verification step
          const { data: idDocDetail } = await admin
            .from("verification_steps")
            .select("first_name, last_name")
            .eq("user_id", step.user_id)
            .eq("step_type", "id_doc")
            .single();

          if (idDocDetail?.first_name && idDocDetail?.last_name) {
            const fullLegalName = `${idDocDetail.first_name} ${idDocDetail.last_name}`;
            legalNamePatch.legal_first_name = idDocDetail.first_name;
            legalNamePatch.legal_last_name = idDocDetail.last_name;
            legalNamePatch.display_name = fullLegalName;
            legalNamePatch.legal_name_locked_at = new Date().toISOString();

            log.info("Propagating legal name from verified ID to profile", {
              userId: step.user_id,
              legalFirstName: idDocDetail.first_name,
              legalLastName: idDocDetail.last_name,
            });
          }
        }

        await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update(legalNamePatch)
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

    // Send transactional email for verification decisions (best-effort, non-blocking)
    try {
      const authAdmin = (
        admin as unknown as {
          auth?: {
            admin?: {
              getUserById?: (id: string) => Promise<{
                data?: {
                  user?: {
                    email?: string | null;
                    user_metadata?: { full_name?: string | null; name?: string | null };
                  } | null;
                };
                error?: { message?: string };
              }>;
            };
          };
        }
      ).auth?.admin;

      if (authAdmin?.getUserById) {
        const { data: targetUser } = await authAdmin.getUserById(step.user_id);
        const recipient = targetUser?.user;
        const recipientEmail = recipient?.email;
        if (recipientEmail) {
          const accountName =
            recipient?.user_metadata?.full_name || recipient?.user_metadata?.name || "there";

          if (decision === "approved") {
            void (async () => {
              const result = await sendVerificationApprovedEmail(recipientEmail, accountName);
              await logAuditEvent({
                actorId: user.id,
                actorRole: adminRole,
                action: result.success ? "communication_email_sent" : "communication_email_failed",
                targetType: "account_profile",
                targetId: step.user_id,
                metadata: {
                  template: "verification_approved",
                  channel: "email",
                  error: result.error,
                  owner_user_id: step.user_id,
                },
              });
            })().catch((emailErr) => {
              log.warn("Failed to send verification approved email", {
                userId: step.user_id,
                error: emailErr instanceof Error ? emailErr.message : "Unknown",
              });
            });
          } else if (decision === "needs_resubmission") {
            const reasonText =
              reasonNote || reasonCode || "Please review and resubmit your details.";
            void (async () => {
              const result = await sendVerificationResubmissionEmail(
                recipientEmail,
                accountName,
                reasonText
              );
              await logAuditEvent({
                actorId: user.id,
                actorRole: adminRole,
                action: result.success ? "communication_email_sent" : "communication_email_failed",
                targetType: "account_profile",
                targetId: step.user_id,
                metadata: {
                  template: "verification_resubmission",
                  channel: "email",
                  error: result.error,
                  owner_user_id: step.user_id,
                },
              });
            })().catch((emailErr) => {
              log.warn("Failed to send verification resubmission email", {
                userId: step.user_id,
                error: emailErr instanceof Error ? emailErr.message : "Unknown",
              });
            });
          } else {
            const reasonText =
              reasonNote || reasonCode || "Your submission did not meet verification requirements.";
            void (async () => {
              const result = await sendVerificationRejectedEmail(
                recipientEmail,
                accountName,
                reasonText
              );
              await logAuditEvent({
                actorId: user.id,
                actorRole: adminRole,
                action: result.success ? "communication_email_sent" : "communication_email_failed",
                targetType: "account_profile",
                targetId: step.user_id,
                metadata: {
                  template: "verification_rejected",
                  channel: "email",
                  error: result.error,
                  owner_user_id: step.user_id,
                },
              });
            })().catch((emailErr) => {
              log.warn("Failed to send verification rejected email", {
                userId: step.user_id,
                error: emailErr instanceof Error ? emailErr.message : "Unknown",
              });
            });
          }
        }
      }
    } catch (emailLookupErr) {
      log.warn("Failed to resolve verification email recipient", {
        userId: step.user_id,
        error: emailLookupErr instanceof Error ? emailLookupErr.message : "Unknown",
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
