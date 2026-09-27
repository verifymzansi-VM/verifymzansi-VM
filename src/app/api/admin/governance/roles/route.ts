import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { reportCriticalIncident } from "@/lib/utils/alerts";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  rateLimitResponse,
} from "@/lib/utils/api";

const log = createLogger("GovernanceRoles");

const reasonSchema = z.string().trim().min(5).max(500);
const noteSchema = z.string().trim().max(500).optional();

const roleChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    targetEmail: z.string().trim().email().max(254),
    newRole: z.enum(["moderator", "governance_controller", "admin", "member"]),
    reason: reasonSchema,
  }),
  z.object({
    action: z.literal("approve"),
    decisionId: z.string().uuid(),
    payloadVersion: z.number().int().min(1),
    note: noteSchema,
  }),
  z.object({
    action: z.literal("reject"),
    decisionId: z.string().uuid(),
    note: noteSchema,
  }),
]);

type RpcResult =
  | {
      ok: true;
      status: "proposed" | "applied" | "rejected" | "withdrawn";
      decision_id?: string;
      target_user_id?: string;
      previous_role?: string;
      new_role?: string;
    }
  | { ok: false; error: string };

/** Map a refusal from the role-change RPCs to an HTTP status and message. */
const REFUSALS: Record<string, [number, string]> = {
  forbidden: [403, "Your role cannot make this change."],
  not_independent: [
    403,
    "Someone other than the proposer and the person affected must approve this change.",
  ],
  self_change: [400, "You cannot change your own role."],
  reason_required: [400, "Give a reason of at least 5 characters."],
  invalid_role: [400, "Choose a valid role."],
  target_not_found: [404, "No account uses that email address."],
  no_change: [409, "This person already has that role."],
  pending_exists: [409, "A change for this person is already waiting for approval."],
  not_found: [404, "That role change could not be found."],
  not_pending: [409, "That role change has already been decided."],
  expired: [410, "That proposal expired. Propose the change again."],
  payload_changed: [409, "The proposal changed after you opened it. Refresh and review it again."],
  stale: [409, "This person's role changed after the proposal was made, so it was cancelled."],
  proposer_lost_authority: [
    409,
    "The person who proposed this no longer has the authority to, so it was cancelled.",
  ],
};

/**
 * POST /api/admin/governance/roles
 *
 * Propose, approve or reject a staff role change. Policy is enforced in the
 * database (see 20260927110100_staff_role_changes.sql): promotions need an
 * independent approver, admin demotions apply immediately, a governor may
 * propose removing a moderator, and nobody changes their own role.
 *
 * Every action needs a second factor verified in the last 15 minutes.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      rateLimitAction: "admin:role:review",
      capability: "role:review",
      stepUp: true,
    });
    if (!guard.success) return guard.response;

    const rl = await checkSensitiveActionRateLimit(guard.user.id, "admin:role:assign", 5);
    if (rl.limited) return rateLimitResponse(rl.retryAfter ?? 60);

    const body = await parseAndValidateJsonRequest(request, roleChangeSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;

    const admin = createAdminClient();
    const actorId = guard.user.id;
    let rpc: { data: unknown; error: { message: string } | null };

    if (body.data.action === "propose") {
      const { data: targetId, error: lookupError } = await admin.rpc("auth_user_id_by_email", {
        p_email: body.data.targetEmail,
      });
      if (lookupError) {
        log.error("Role change target lookup failed", { error: lookupError.message });
        return internalApiError();
      }
      if (typeof targetId !== "string") {
        return NextResponse.json({ error: REFUSALS.target_not_found[1] }, { status: 404 });
      }
      rpc = await admin.rpc("propose_staff_role_change", {
        p_actor: actorId,
        p_target: targetId,
        p_role: body.data.newRole,
        p_reason: body.data.reason,
      });
    } else if (body.data.action === "approve") {
      rpc = await admin.rpc("approve_staff_role_change", {
        p_actor: actorId,
        p_decision: body.data.decisionId,
        p_payload_version: body.data.payloadVersion,
        p_note: body.data.note ?? null,
      });
    } else {
      rpc = await admin.rpc("reject_staff_role_change", {
        p_actor: actorId,
        p_decision: body.data.decisionId,
        p_note: body.data.note ?? null,
      });
    }

    if (rpc.error) {
      if (rpc.error.message.includes("last active admin")) {
        return NextResponse.json(
          { error: "The last active admin cannot be removed. Add another admin first." },
          { status: 409 }
        );
      }
      log.error("Role change RPC failed", { action: body.data.action, error: rpc.error.message });
      return internalApiError();
    }

    const result = rpc.data as RpcResult;
    if (!result.ok) {
      const [status, message] = REFUSALS[result.error] ?? [400, "This role change was refused."];
      return NextResponse.json({ error: message, code: result.error }, { status });
    }

    // staff_roles is the authority and is already committed. The JWT role is
    // only a UI hint, so a failed sync is reported, not returned as an error.
    let metadataSynced = true;
    if (result.status === "applied" && result.target_user_id && result.new_role) {
      metadataSynced = await syncRoleMetadata(
        admin,
        result.target_user_id,
        result.new_role,
        result.decision_id
      );
    }

    return NextResponse.json({
      status: result.status,
      decisionId: result.decision_id ?? null,
      previousRole: result.previous_role ?? null,
      newRole: result.new_role ?? null,
      metadataSynced,
    });
  } catch (err) {
    logApiError(log, "role change", err);
    return internalApiError();
  }
}

async function syncRoleMetadata(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  decisionId: string | undefined
): Promise<boolean> {
  try {
    const { data, error: readError } = await admin.auth.admin.getUserById(userId);
    if (readError || !data?.user) throw new Error(readError?.message ?? "user not found");
    const { error } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...data.user.app_metadata, role },
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    reportCriticalIncident("GovernanceRoles", "Role changed but auth metadata sync failed", {
      userId,
      role,
      decisionId: decisionId ?? null,
      error: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}
