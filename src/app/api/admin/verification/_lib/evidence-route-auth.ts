import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import type { AppLogger } from "@/lib/utils/logger";
import type { StaffRole } from "@/types/enums";

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

  const rateLimit = checkLocalRateLimit(user.id, rateLimitAction);
  if (rateLimit.limited) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Too many requests", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) } }
      ),
      status: 429,
    };
  }

  return {
    success: true,
    user,
    role,
  };
}
