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
        .single();
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
        .single();
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
        .single();
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
    if (SENSITIVE_ACTIONS.includes(action) && !hasCapability(user, "decision:approve")) {
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
        log.warn("Decision record creation failed; continuing with direct enforcement", {
          reportId,
          action,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (record) {
        // Record moderation action as "pending_approval"
        await admin.from("moderation_actions").insert({
          report_id: reportId,
          actor_id: user.id,
          action: `${action}_recommended`,
          target_owner_id: ownerId,
          area: report.area || null,
          reason: reason || null,
          duration_days: action === "suspend" ? durationDays : null,
        });

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
      // If decision record creation fails, fall through to direct execution
      // (graceful degradation) — logged by the ledger service
    }

    // Execute action
    if (action === "warn" && ownerId) {
      const { error: rpcErr } = await admin.rpc("increment_strikes", { owner_id_input: ownerId });
      if (rpcErr) {
        // If RPC doesn't exist, do manual update
        await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update({ account_status: "warned" })
          .eq("user_id", ownerId);
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
        await admin.from(table).update({ status: "hidden" }).eq("id", report.target_id);
      }
    } else if (action === "suspend" && ownerId) {
      const suspendUntil = new Date();
      suspendUntil.setDate(suspendUntil.getDate() + (durationDays || 7));

      await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_status: "suspended",
          suspended_until: suspendUntil.toISOString(),
        })
        .eq("user_id", ownerId);

      // Hide all content for the suspended account holder
      await admin
        .from("listings")
        .update({ status: "hidden" })
        .eq(listingsOwnerCol, ownerId)
        .eq("status", "live");
      await admin
        .from("businesses")
        .update({ status: "hidden" })
        .eq(businessesOwnerCol, ownerId)
        .eq("status", "live");
      await admin
        .from("promotions")
        .update({ status: "hidden" })
        .eq(promotionsOwnerCol, ownerId)
        .eq("status", "live");
    } else if (action === "ban" && ownerId) {
      await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_status: "banned",
          banned_at: new Date().toISOString(),
          ban_reason: reason || "Violation of terms",
        })
        .eq("user_id", ownerId);

      // Hide all content
      await admin.from("listings").update({ status: "hidden" }).eq(listingsOwnerCol, ownerId);
      await admin.from("businesses").update({ status: "hidden" }).eq(businessesOwnerCol, ownerId);
      await admin.from("promotions").update({ status: "hidden" }).eq(promotionsOwnerCol, ownerId);
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
    await admin.from("moderation_actions").insert({
      report_id: reportId,
      actor_id: user.id,
      action,
      target_owner_id: ownerId,
      area: report.area || null,
      reason: reason || null,
      duration_days: action === "suspend" ? durationDays : null,
    });

    // Resolve the report
    const reportStatus = action === "dismiss" ? "dismissed" : "resolved";
    await admin
      .from("reports")
      .update({
        status: reportStatus,
        assigned_to: user.id,
      })
      .eq("id", reportId);

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
