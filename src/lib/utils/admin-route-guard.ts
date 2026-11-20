import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { readStaffAccessFromDb, staffRoleMeeting } from "@/lib/auth/admin-access";
import type { Capability } from "@/lib/auth/roles";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { authenticateStaffRequest } from "@/lib/auth/staff-session";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { forbiddenResponse } from "@/lib/utils/api";
import type { Logger } from "@/lib/utils/logger";
import type { StaffRole } from "@/types/enums";

type GuardSuccess = {
  success: true;
  user: User;
  actorRole: StaffRole;
  /** The caller's own live-backend API; staff commands re-check authority in SQL. */
  api: FoundationAuthenticatedApi;
  /** Send the route's responses through this, so refreshed session cookies
   * and private cache headers reach the browser. */
  respond: <T>(response: NextResponse<T>) => Promise<NextResponse<T>>;
};

type GuardFailure = {
  success: false;
  response: NextResponse;
};

/**
 * Guard for a back-office API mutation on the live backend: same origin, CSRF,
 * an Auth-verified session, the staff role or capability read from the
 * database, the staff two-step policy (authenticator app within 12 hours; 15
 * minutes when `stepUp`), then the per-account rate limit. Each check refuses
 * the request when it fails or cannot be completed.
 */
export async function enforceAdminMutationGuard({
  request,
  logger,
  rateLimitAction,
  capability,
  adminOnly,
  forbiddenMessage,
  rateLimitMessage = "Too many requests. Please try again later.",
  stepUp = false,
}: {
  request: Request;
  logger: Logger;
  rateLimitAction: string;
  capability?: Capability;
  adminOnly?: boolean;
  forbiddenMessage?: string;
  rateLimitMessage?: string;
  /** Sensitive action: require a second factor verified in the last 15 minutes. */
  stepUp?: boolean;
}): Promise<GuardSuccess | GuardFailure> {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return { success: false, response: originBlock };

  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return { success: false, response: csrfBlock };

  // Every refusal below fails closed: no session, no staff access, no MFA.
  const session = await authenticateStaffRequest(request);
  if (!session.ok) return { success: false, response: session.response };
  const { caller, respond } = session;
  const refuse = async (response: NextResponse): Promise<GuardFailure> => ({
    success: false,
    response: await respond(response),
  });

  const access = await readStaffAccessFromDb(caller.api);
  const actorRole = staffRoleMeeting(access, { adminOnly, capability });
  if (!access || !actorRole) return refuse(forbiddenResponse(forbiddenMessage));

  const mfaBlock = await checkStaffApiMfa(
    { access, accountId: caller.accountId, authenticatorAt: caller.authenticatorAt },
    { stepUp }
  );
  if (mfaBlock) return refuse(mfaBlock);

  const rateLimit = checkLocalRateLimit(caller.accountId, rateLimitAction);
  if (rateLimit.limited) {
    return refuse(
      NextResponse.json(
        { error: rateLimitMessage, retryAfter: rateLimit.retryAfter ?? 60 },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) } }
      )
    );
  }

  return { success: true, user: caller.user, actorRole, api: caller.api, respond };
}
