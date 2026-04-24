import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminFlaggingActionSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { ACCOUNT_PROFILE_WRITE_TABLE, getOwnerColumn } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sendAccountEnforcementEmail } from "@/lib/services/email";
import { hasCapability } from "@/lib/auth/roles";
import { createDecisionRecord } from "@/lib/services/decision-ledger";
import type { StaffRole } from "@/types/enums";

const log = createLogger("AdminFlagging");

/**
 * POST /api/admin/flagging/action
 * Execute enforcement action on a flagged report.
 */
export async function POST(request: Request) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

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

    const rl = checkLocalRateLimit(user.id, "admin:flagging:action");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, adminFlaggingActionSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { reportId, action, reason, durationDays } = parsedBody.data;

    const admin = createAdminClient();

    // Get the report
    const { data: report, error: reportError } = await admin
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (reportError || !report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Resolve owner columns via compat layer
    const [listingsOwnerCol, businessesOwnerCol, promotionsOwnerCol] = await Promise.all([
      getOwnerColumn(admin as never, "listings").catch(() => "owner_id" as const),
      getOwnerColumn(admin as never, "businesses").catch(() => "owner_id" as const),
      getOwnerColumn(admin as never, "promotions").catch(() => "owner_id" as const),
    ]);

    // Get the account holder for this target
    let ownerId: string | null = null;

    if (report.target_type === "listing") {
      const { data: listing, error: listingErr } = await admin
        .from("listings")
        .select(listingsOwnerCol)
        .eq("id", report.target_id)
        .maybeSingle();
      if (listingErr) {
        log.warn("Target listing not found", {
          targetId: report.target_id,
          error: listingErr.message,
        });
      }
      ownerId = ((listing as Record<string, unknown> | null)?.[listingsOwnerCol] as string) || null;
    } else if (report.target_type === "account_profile") {
      ownerId = report.target_id;
    } else if (
      report.target_type === "storefront" ||
      report.target_type === "business_profile" ||
      report.target_type === "business"
    ) {
      const { data: biz, error: bizErr } = await admin
        .from("businesses")
        .select(businessesOwnerCol)
        .eq("id", report.target_id)
        .maybeSingle();
      if (bizErr) {
        log.warn("Target business not found", {
          targetId: report.target_id,
          error: bizErr.message,
        });
      }
      ownerId = ((biz as Record<string, unknown> | null)?.[businessesOwnerCol] as string) || null;
    } else if (report.target_type === "promotion") {
      const { data: promotion, error: promotionErr } = await admin
        .from("promotions")
        .select(promotionsOwnerCol)
        .eq("id", report.target_id)
        .maybeSingle();
      if (promotionErr) {
        log.warn("Target promotion not found", {
          targetId: report.target_id,
          error: promotionErr.message,
        });
      }
      ownerId =
        ((promotion as Record<string, unknown> | null)?.[promotionsOwnerCol] as string) || null;
    }

    // Actions that target an account holder require a valid owner reference
    const ownerTargetedActions = ["warn", "suspend", "ban"];
    if (ownerTargetedActions.includes(action) && !ownerId) {
      return NextResponse.json(
        { error: "Target content not found or has no associated account holder" },
        { status: 404 }
      );
    }

    // ── Decision Ledger Gate ───────────────────────────────────────────
    // Sensitive actions (ban/suspend) require governance approval unless
    // the actor already has the decision:approve capability.
    const SENSITIVE_ACTIONS = ["ban", "suspend"];
    const dbVerifiedActor = {
      app_metadata: { role: adminRole },
      is_anonymous: false,
    };
    if (SENSITIVE_ACTIONS.includes(action) && !hasCapability(dbVerifiedActor, "decision:approve")) {
      let record: { id: string } | null = null;
      try {
        record = await createDecisionRecord({
          caseType: "report",
          caseId: reportId,
          actionCategory: action === "ban" ? "account_ban" : "account_suspend",
          recommenderId: user.id,
          recommenderRole: adminRole as StaffRole,
          recommendation: action,
          rationale: reason || `Recommended: ${action}`,
          evidenceRefs: [reportId],
          beforeState: {
            reportId,
            targetType: report.target_type,
            targetId: report.target_id,
            ownerId,
            currentStatus: report.status,
          },
        });
      } catch (err) {
        log.error("Decision record creation failed; blocking direct sensitive enforcement", {
          reportId,
          action,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (record) {
        // Record moderation action as "pending_approval"
        const { error: recInsertErr } = await admin.from("moderation_actions").insert({
          report_id: reportId,
          actor_id: user.id,
          action: `${action}_recommended`,
          target_owner_id: ownerId,
          area: report.area || null,
          reason: reason || null,
          duration_days: action === "suspend" ? durationDays : null,
        });
        if (recInsertErr) {
          log.error("Failed to record recommended moderation action (non-fatal)", {
            error: recInsertErr.message,
            reportId,
          });
        }

        await logAuditEvent({
          actorId: user.id,
          actorRole: adminRole,
          action: "decision_recommended",
          targetType: "report",
          targetId: reportId,
          metadata: {
            enforcement_action: action,
            decision_record_id: record.id,
            reason,
            ownerId,
          },
        });

        return NextResponse.json({
          success: true,
          action: `${action}_recommended`,
          status: "pending_approval",
          decisionRecordId: record.id,
          message: `${action} recommended. Awaiting governance approval.`,
        });
      }

      return NextResponse.json(
        {
          error: "Decision approval workflow unavailable",
          code: "decision_workflow_unavailable",
        },
        { status: 503 }
      );
    }

    // Execute action
    if (action === "warn" && ownerId) {
      const { error: rpcErr } = await admin.rpc("increment_strikes", { owner_id_input: ownerId });
      if (rpcErr) {
        // If RPC doesn't exist, do manual update
        const { error: warnErr } = await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update({ account_status: "warned" })
          .eq("user_id", ownerId);
        if (warnErr) {
          log.error("Failed to apply warn enforcement", { error: warnErr.message, ownerId });
          return NextResponse.json(
            { error: "Failed to apply enforcement action" },
            { status: 500 }
          );
        }
      }
    } else if (action === "hide") {
      const tableMap: Record<string, string> = {
        listing: "listings",
        promotion: "promotions",
        storefront: "businesses",
        business_profile: "businesses",
        business: "businesses",
      };
      const table = tableMap[report.target_type];
      if (table) {
        const { error: hideErr } = await admin
          .from(table)
          .update({ status: "hidden" })
          .eq("id", report.target_id);
        if (hideErr) {
          log.error("Failed to hide content", {
            error: hideErr.message,
            targetId: report.target_id,
            table,
          });
          return NextResponse.json(
            { error: "Failed to apply enforcement action" },
            { status: 500 }
          );
        }
      }
    } else if (action === "suspend" && ownerId) {
      const suspendUntil = new Date();
      suspendUntil.setDate(suspendUntil.getDate() + (durationDays ?? 7));

      const { error: suspendErr } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_status: "suspended",
          suspended_until: suspendUntil.toISOString(),
        })
        .eq("user_id", ownerId);
      if (suspendErr) {
        log.error("Failed to suspend account", { error: suspendErr.message, ownerId });
        return NextResponse.json({ error: "Failed to apply enforcement action" }, { status: 500 });
      }

      // Hide all content for the suspended account holder (best-effort)
      const { error: hideListErr } = await admin
        .from("listings")
        .update({ status: "hidden" })
        .eq(listingsOwnerCol, ownerId)
        .eq("status", "live");
      if (hideListErr)
        log.error("Failed to hide listings for suspended user (non-fatal)", {
          error: hideListErr.message,
          ownerId,
        });
      const { error: hideBizErr } = await admin
        .from("businesses")
        .update({ status: "hidden" })
        .eq(businessesOwnerCol, ownerId)
        .eq("status", "live");
      if (hideBizErr)
        log.error("Failed to hide businesses for suspended user (non-fatal)", {
          error: hideBizErr.message,
          ownerId,
        });
      const { error: hidePromoErr } = await admin
        .from("promotions")
        .update({ status: "hidden" })
        .eq(promotionsOwnerCol, ownerId)
        .eq("status", "live");
      if (hidePromoErr)
        log.error("Failed to hide promotions for suspended user (non-fatal)", {
          error: hidePromoErr.message,
          ownerId,
        });
    } else if (action === "ban" && ownerId) {
      const { error: banErr } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_status: "banned",
          banned_at: new Date().toISOString(),
          ban_reason: reason || "Violation of terms",
        })
        .eq("user_id", ownerId);
      if (banErr) {
        log.error("Failed to ban account", { error: banErr.message, ownerId });
        return NextResponse.json({ error: "Failed to apply enforcement action" }, { status: 500 });
      }

      // Hide all content (best-effort)
      const { error: banListErr } = await admin
        .from("listings")
        .update({ status: "hidden" })
        .eq(listingsOwnerCol, ownerId);
      if (banListErr)
        log.error("Failed to hide listings for banned user (non-fatal)", {
          error: banListErr.message,
          ownerId,
        });
      const { error: banBizErr } = await admin
        .from("businesses")
        .update({ status: "hidden" })
        .eq(businessesOwnerCol, ownerId);
      if (banBizErr)
        log.error("Failed to hide businesses for banned user (non-fatal)", {
          error: banBizErr.message,
          ownerId,
        });
      const { error: banPromoErr } = await admin
        .from("promotions")
        .update({ status: "hidden" })
        .eq(promotionsOwnerCol, ownerId);
      if (banPromoErr)
        log.error("Failed to hide promotions for banned user (non-fatal)", {
          error: banPromoErr.message,
          ownerId,
        });
    }

    // Send enforcement emails to affected account holders (non-blocking)
    if ((action === "warn" || action === "suspend" || action === "ban") && ownerId) {
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
                }>;
              };
            };
          }
        ).auth?.admin;
        const { data: ownerUserData } = authAdmin?.getUserById
          ? await authAdmin.getUserById(ownerId)
          : { data: { user: { email: null } } };

        const ownerEmail = ownerUserData?.user?.email;
        if (ownerEmail) {
          const accountName =
            ownerUserData.user?.user_metadata?.full_name ||
            ownerUserData.user?.user_metadata?.name ||
            "there";
          const suspendedUntil =
            action === "suspend" && durationDays
              ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString()
              : null;

          void (async () => {
            const result = await sendAccountEnforcementEmail({
              email: ownerEmail,
              accountName,
              action,
              reason,
              suspendedUntil,
            });

            await logAuditEvent({
              actorId: user.id,
              actorRole: adminRole,
              action: result.success ? "communication_email_sent" : "communication_email_failed",
              targetType: "account_profile",
              targetId: ownerId,
              metadata: {
                template: `account_${action}`,
                channel: "email",
                error: result.error,
                owner_user_id: ownerId,
              },
            });
          })().catch((emailErr) => {
            log.warn("Failed to send enforcement email", {
              action,
              ownerId,
              reportId,
              error: emailErr instanceof Error ? emailErr.message : "Unknown",
            });
          });
        }
      } catch (emailLookupErr) {
        log.warn("Failed to resolve enforcement email recipient", {
          action,
          ownerId,
          reportId,
          error: emailLookupErr instanceof Error ? emailLookupErr.message : "Unknown",
        });
      }
    }

    // Record moderation action
    const { error: modInsertErr } = await admin.from("moderation_actions").insert({
      report_id: reportId,
      actor_id: user.id,
      action,
      target_owner_id: ownerId,
      area: report.area || null,
      reason: reason || null,
      duration_days: action === "suspend" ? durationDays : null,
    });
    if (modInsertErr) {
      log.error("Failed to record moderation action", {
        error: modInsertErr.message,
        reportId,
        action,
      });
      return NextResponse.json({ error: "Failed to record enforcement action" }, { status: 500 });
    }

    // Resolve the report
    const reportStatus = action === "dismiss" ? "dismissed" : "resolved";
    const { error: reportUpdateErr } = await admin
      .from("reports")
      .update({
        status: reportStatus,
        assigned_to: user.id,
      })
      .eq("id", reportId);
    if (reportUpdateErr) {
      log.error("Failed to resolve report (non-fatal)", {
        error: reportUpdateErr.message,
        reportId,
      });
    }

    // Audit log
    const auditActionMap: Record<string, string> = {
      warn: "moderation_action",
      hide: "moderation_action",
      suspend: "account_suspended",
      ban: "account_banned",
      dismiss: "report_resolved",
    };

    await logAuditEvent({
      actorId: user.id,
      actorRole: adminRole,
      action: (auditActionMap[action] || "moderation_action") as
        | "moderation_action"
        | "account_suspended"
        | "account_banned"
        | "report_resolved",
      targetType: "report",
      targetId: reportId,
      metadata: {
        enforcement_action: action,
        reason,
        durationDays,
        ownerId,
        owner_user_id: ownerId,
        target_type: report.target_type,
        target_id: report.target_id,
      },
    });

    return NextResponse.json({ success: true, action, reportStatus });
  } catch (error) {
    logApiError(log, "Flagging action failed", error);
    return internalApiError();
  }
}
