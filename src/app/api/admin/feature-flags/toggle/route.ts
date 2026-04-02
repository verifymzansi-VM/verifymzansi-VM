/**
 * POST /api/admin/feature-flags/toggle
 * Update a feature flag configuration. Admin-only.
 *
 * Accepts two payload formats:
 * - Legacy:  { key, enabled }          → maps to mode "on"/"off"
 * - Canary:  { key, mode, percent?, allowlist_roles?, reason }
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toggleFeatureFlag, updateFeatureFlagConfig } from "@/lib/services/feature-flags";
import { logAuditEvent } from "@/lib/services/audit";
import { verifyAdminActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("FeatureFlagsToggle");

// Legacy format — backward compatible for one release cycle
const legacySchema = z.object({
  key: z.string().min(1).max(100),
  enabled: z.boolean(),
});

// Canary format — new payload
const canarySchema = z.object({
  key: z.string().min(1).max(100),
  mode: z.enum(["off", "on", "percent", "allowlist"]),
  percent: z.number().int().min(0).max(100).optional(),
  allowlist_roles: z.array(z.string()).optional(),
  reason: z.string().min(1).max(500),
});

export async function POST(request: NextRequest) {
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

    const actorRole = await verifyAdminActorRoleFromDb(user);
    if (!actorRole) {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:feature-flags:toggle");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const bodyResult = await parseAndValidateJsonRequest(request, z.unknown(), {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request body",
      includeValidationDetails: false,
    });

    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const body = bodyResult.data;

    // Try canary format first, then fall back to legacy
    const canaryParsed = canarySchema.safeParse(body);
    if (canaryParsed.success) {
      const { key, mode, percent, allowlist_roles, reason } = canaryParsed.data;

      const result = await updateFeatureFlagConfig(key, {
        mode,
        percent,
        allowlistRoles: allowlist_roles,
        updatedBy: user.id,
        reason,
      });

      if (!result.success) {
        log.error("Failed to update feature flag config", { key, error: result.error });
        return NextResponse.json({ error: "Failed to update feature flag" }, { status: 500 });
      }

      await logAuditEvent({
        actorId: user.id,
        actorRole,
        action: "feature_flag_toggled",
        targetType: "feature_flag",
        targetId: key,
        metadata: { key, mode, percent, allowlist_roles, reason },
      });

      return NextResponse.json({ success: true, key, mode, percent, allowlist_roles });
    }

    // Legacy format
    const legacyParsed = legacySchema.safeParse(body);
    if (legacyParsed.success) {
      const { key, enabled } = legacyParsed.data;

      const result = await toggleFeatureFlag(key, enabled);

      if (!result.success) {
        log.error("Failed to toggle feature flag", { key, error: result.error });
        return NextResponse.json({ error: "Failed to toggle feature flag" }, { status: 500 });
      }

      await logAuditEvent({
        actorId: user.id,
        actorRole,
        action: "feature_flag_toggled",
        targetType: "feature_flag",
        targetId: key,
        metadata: { key, enabled },
      });

      return NextResponse.json({ success: true, key, enabled });
    }

    // Neither format matched — include errors from both schemas
    const canaryErrors = canaryParsed.error.issues.map((i) => i.message);
    const legacyErrors = legacyParsed.error.issues.map((i) => i.message);
    const allErrors = [...new Set([...canaryErrors, ...legacyErrors])];
    return NextResponse.json({ error: allErrors[0] || "Invalid request body" }, { status: 400 });
  } catch (error) {
    logApiError(log, "Toggle error", error);
    return internalApiError();
  }
}
