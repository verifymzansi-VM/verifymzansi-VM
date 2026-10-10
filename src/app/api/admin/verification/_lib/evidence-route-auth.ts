import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import type { AppLogger } from "@/lib/utils/logger";
import type { StaffRole } from "@/types/enums";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";

type EvidenceAuthSuccess = {
  success: true;
  user: { id: string };
  role: StaffRole;
};

type EvidenceAuthFailure = {
  success: false;
  response: NextResponse;
  status: number;
};

export async function authorizeEvidenceRequest({
  rateLimitAction,
}: {
  log: AppLogger;
  rateLimitAction: string;
}): Promise<EvidenceAuthSuccess | EvidenceAuthFailure> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 }),
      status: 401,
    };
  }

  const role = await verifyStaffActorRoleFromDb(user);
  if (!role) {
    return {
      success: false,
      response: NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 }),
      status: 403,
    };
  }

  const mfaBlock = await checkStaffApiMfa(supabase, user.id, { stepUp: true });
  if (mfaBlock) {
    return { success: false, response: mfaBlock, status: 403 };
  }

  const rateLimit = await checkSensitiveActionRateLimit(user.id, rateLimitAction);
  if (rateLimit.limited) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: rateLimit.degraded
            ? "Evidence access protection is unavailable"
            : "Too many requests",
          code: rateLimit.degraded ? "protection_unavailable" : "rate_limited",
        },
        {
          status: rateLimit.degraded ? 503 : 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
        }
      ),
      status: rateLimit.degraded ? 503 : 429,
    };
  }

  return {
    success: true,
    user,
    role,
  };
}
