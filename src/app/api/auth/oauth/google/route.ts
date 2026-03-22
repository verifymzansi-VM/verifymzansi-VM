import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleOAuthInitSchema } from "@/lib/validations/auth";
import { buildAuthCallbackUrl } from "@/lib/utils/auth-redirect";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("GoogleOAuthInit");

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    const rl = checkLocalRateLimit(getClientIp(request), "auth:google-oauth");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, googleOAuthInitSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const nextPath = sanitizeReturnUrl(parsedBody.data.returnUrl);
    const supabase = await createClient();
    const redirectTo = buildAuthCallbackUrl(request, nextPath);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      log.warn("Google OAuth init failed", {
        error: error?.message ?? "missing_oauth_url",
        nextPath,
      });
      return NextResponse.json(
        { error: "Google sign-in is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    }

    return NextResponse.json({ url: data.url });
  } catch (error) {
    logApiError(log, "Unexpected Google OAuth init error", error);
    return internalApiError();
  }
}
