import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  verifyAdminActorRoleFromDb,
  verifyCapabilityRoleFromDb,
  verifyStaffActorRoleFromDb,
} from "@/lib/auth/admin-access";
import type { Capability } from "@/lib/auth/roles";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { forbiddenResponse, unauthorizedResponse } from "@/lib/utils/api";
import type { Logger } from "@/lib/utils/logger";
import type { StaffRole } from "@/types/enums";

type GuardSuccess = {
  success: true;
  user: User;
  actorRole: StaffRole;
};

type GuardFailure = {
  success: false;
  response: NextResponse;
};

export async function enforceAdminMutationGuard({
  request,
  logger,
  rateLimitAction,
  capability,
  adminOnly,
  forbiddenMessage,
  rateLimitMessage = "Too many requests. Please try again later.",
}: {
  request: Request;
  logger: Logger;
  rateLimitAction: string;
  capability?: Capability;
  adminOnly?: boolean;
  forbiddenMessage?: string;
  rateLimitMessage?: string;
}): Promise<GuardSuccess | GuardFailure> {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return { success: false, response: originBlock };

  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return { success: false, response: csrfBlock };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, response: unauthorizedResponse() };
  }

  const actorRole = adminOnly
    ? await verifyAdminActorRoleFromDb(user)
    : capability
      ? await verifyCapabilityRoleFromDb(user, capability)
      : await verifyStaffActorRoleFromDb(user);
  if (!actorRole) {
    return { success: false, response: forbiddenResponse(forbiddenMessage) };
  }

  const rateLimit = checkLocalRateLimit(user.id, rateLimitAction);
  if (rateLimit.limited) {
    return {
      success: false,
      response: NextResponse.json(
        { error: rateLimitMessage, retryAfter: rateLimit.retryAfter ?? 60 },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) } }
      ),
    };
  }

  return { success: true, user, actorRole };
}
