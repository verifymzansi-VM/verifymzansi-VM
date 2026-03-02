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
import { isAdmin } from "@/lib/auth/roles";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAdmin(user)) {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:feature-flags:toggle");
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
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      await logAuditEvent({
        actorId: user.id,
        actorRole: "admin",
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
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      await logAuditEvent({
        actorId: user.id,
        actorRole: "admin",
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
  } catch (err) {
    log.error("Toggle error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
