import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import type { AppLogger } from "@/lib/utils/logger";

type BillingGuardSuccess = {
  success: true;
  user: {
    id: string;
    email_confirmed_at?: string | null;
  };
  supabase: Awaited<ReturnType<typeof createClient>>;
};

type BillingGuardFailure = {
  success: false;
  response: NextResponse;
};

export async function enforceBillingMutationGuard({
  request,
  log,
  rateLimitAction,
  rateLimitKey,
  degradedMessage,
  limitedMessage,
  requireConfirmedEmailMessage,
}: {
  request: NextRequest;
  log: AppLogger;
  rateLimitAction: string;
  rateLimitKey?: (userId: string, ip: string) => string;
  degradedMessage: string;
  limitedMessage: string;
  requireConfirmedEmailMessage?: string;
}): Promise<BillingGuardSuccess | BillingGuardFailure> {
  const mutationBlock = enforceMutationRequest(request, log);
  if (mutationBlock) return { success: false, response: mutationBlock };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (requireConfirmedEmailMessage && !user.email_confirmed_at) {
    return {
      success: false,
      response: NextResponse.json({ error: requireConfirmedEmailMessage }, { status: 403 }),
    };
  }

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({
    key: rateLimitKey ? rateLimitKey(user.id, ip) : ip,
    action: rateLimitAction,
    degradedMode: "block",
  });
  if (rateCheck.limited) {
    return {
      success: false,
      response: rateLimitExceededResponse({
        degraded: rateCheck.degraded,
        retryAfter: rateCheck.retryAfter,
        degradedMessage,
        limitedMessage,
      }),
    };
  }

  return { success: true, user, supabase };
}
