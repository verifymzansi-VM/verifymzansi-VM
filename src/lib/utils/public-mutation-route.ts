import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { rateLimitExceededResponse } from "@/lib/utils/rate-limit-responses";
import type { Logger } from "@/lib/utils/logger";
import type { User } from "@supabase/supabase-js";

type PublicMutationPreludeResult =
  | { success: true; user: User | null }
  | { success: false; response: NextResponse };

async function verifyPublicTurnstile(request: NextRequest, token: string, logger: Logger) {
  if (process.env.TURNSTILE_SECRET_KEY) {
    const captchaResult = await verifyTurnstileToken({
      token,
      remoteIp: getClientIp(request),
    });

    if (!captchaResult.success) {
      return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
    }
  } else if (process.env.NODE_ENV === "production") {
    logger.error("TURNSTILE_SECRET_KEY not configured in production");
    return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
  }

  return null;
}

export async function enforcePublicMutationPrelude({
  request,
  logger,
  turnstileToken,
  rateLimitAction,
  rateLimitMessage,
}: {
  request: NextRequest;
  logger: Logger;
  turnstileToken: string;
  rateLimitAction: string;
  rateLimitMessage: string;
}): Promise<PublicMutationPreludeResult> {
  const mutationBlock = enforceMutationRequest(request, logger);
  if (mutationBlock) return { success: false, response: mutationBlock };

  const turnstileBlock = await verifyPublicTurnstile(request, turnstileToken, logger);
  if (turnstileBlock) return { success: false, response: turnstileBlock };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimitKey = user?.id || getClientIp(request) || "unknown";
  const rateLimit = await checkRateLimit({ key: rateLimitKey, action: rateLimitAction });
  if (rateLimit.limited) {
    return {
      success: false,
      response: rateLimitExceededResponse({
        degraded: false,
        retryAfter: rateLimit.retryAfter,
        degradedMessage: rateLimitMessage,
        limitedMessage: rateLimitMessage,
      }),
    };
  }

  return { success: true, user };
}
