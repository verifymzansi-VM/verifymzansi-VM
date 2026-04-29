import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import type { Logger } from "@/lib/utils/logger";

type AuthenticatedMutationSuccess = {
  success: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
};

type AuthenticatedMutationFailure = {
  success: false;
  response: NextResponse;
};

export async function enforceAuthenticatedMutationRequest({
  request,
  logger,
  rateLimitAction,
}: {
  request: Request;
  logger: Logger;
  rateLimitAction: string;
}): Promise<AuthenticatedMutationSuccess | AuthenticatedMutationFailure> {
  const mutationBlock = enforceMutationRequest(request, logger);
  if (mutationBlock) {
    return { success: false, response: mutationBlock };
  }

  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: rateLimitAction });
  if (rateCheck.limited) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    };
  }

  return { success: true, supabase, user };
}
