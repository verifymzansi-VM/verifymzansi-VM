import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { getRoleFromUser, isAllowedAdmin } from "@/lib/auth/roles";
import { recordRoleChange } from "@/lib/services/decision-ledger";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { z } from "zod";
import type { StaffRole } from "@/types/enums";

const log = createLogger("GovernanceRoles");

const ASSIGNABLE_ROLES = ["moderator", "governance_controller", "member"] as const;

const roleAssignSchema = z.object({
  targetEmail: z.string().email().max(254),
  newRole: z.enum(ASSIGNABLE_ROLES),
  reason: z.string().min(5).max(500).trim(),
});

/**
 * POST /api/admin/governance/roles
 *
 * Admin-only endpoint to assign or revoke staff roles.
 *
 * Security layers (in order):
 *   L1 — Same-origin enforcement
 *   L2 — CSRF double-submit
 *   L3 — DB-verified role:assign capability
 *   L4 — Hardcoded admin email allowlist
 *   L5 — Rate limit (5/min)
 */
export async function POST(request: Request) {
  try {
    // L1: Same-origin check
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    // L2: CSRF double-submit check
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    // Auth: Get current user
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // L3: DB-verified capability check (guards against stale JWTs)
    const verified = await verifyCapabilityFromDb(user, "role:assign");
    if (!verified) {
      log.warn("Role assign rejected: capability check failed", { actorId: user.id });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // L4: Hardcoded admin email allowlist (tamper-proof, not in DB)
    if (!isAllowedAdmin(user.email)) {
      log.warn("Role assign rejected: email not in admin allowlist", { actorId: user.id });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // L5: Tight rate limit — max 5 role changes per minute
    const rl = checkLocalRateLimit(user.id, "admin:role:assign", 5);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Parse and validate request body
    const bodyResult = await parseAndValidateJsonRequest(request, roleAssignSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { targetEmail, newRole, reason } = bodyResult.data;

    // Block self-role-change (prevent admin from locking themselves out)
    const targetNormalized = targetEmail.toLowerCase().trim();
    if (user.email?.toLowerCase().trim() === targetNormalized) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    // Lookup target user by email using admin API
    const admin = createAdminClient();
    // Search through all users for exact email match
    let targetUser: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null =
      null;
    const perPage = 200;
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) {
        log.error("Failed to list users during target lookup", { error: error.message });
        return internalApiError();
      }

      const users = data?.users ?? [];
      const found = users.find((u) => u.email?.toLowerCase().trim() === targetNormalized);
      if (found) {
        targetUser = found;
        break;
      }
      if (users.length < perPage) break;
    }

    if (!targetUser) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }

    // Read current role
    const currentRole = getRoleFromUser({
      app_metadata: targetUser.app_metadata ?? {},
      is_anonymous: false,
    });

    // Idempotency guard: return 409 if already the requested role
    const effectiveNewRole = newRole === "member" ? null : newRole;
    const effectiveCurrentRole = currentRole === "member" || !currentRole ? null : currentRole;
    if (effectiveNewRole === effectiveCurrentRole) {
      return NextResponse.json({ error: "User already has the requested role" }, { status: 409 });
    }

    // Execute the role change
    const roleForMetadata = newRole === "member" ? "member" : newRole;
    const { error: updateError } = await admin.auth.admin.updateUserById(targetUser.id, {
      app_metadata: { ...targetUser.app_metadata, role: roleForMetadata },
    });

    if (updateError) {
      log.error("Failed to update user role", {
        targetUserId: targetUser.id,
        error: updateError.message,
      });
      return internalApiError();
    }

    // Record in audit trail
    const actorRole = getRoleFromUser(user) as StaffRole;
    await recordRoleChange({
      targetUserId: targetUser.id,
      previousRole: currentRole,
      newRole: roleForMetadata,
      assignedBy: user.id,
      assignerRole: actorRole,
      reason,
    });

    log.info("Role assigned successfully", {
      actorId: user.id,
      targetUserId: targetUser.id,
      previousRole: currentRole,
      newRole: roleForMetadata,
    });

    // No PII (email) in response body
    return NextResponse.json({
      status: "ok",
      targetUserId: targetUser.id,
      previousRole: currentRole,
      newRole: roleForMetadata,
    });
  } catch (err) {
    logApiError(log, "role assignment", err);
    return internalApiError();
  }
}
