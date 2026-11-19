import { NextResponse, type NextRequest } from "next/server";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { getClientIp } from "@/lib/utils/rate-limit";
import type { Logger } from "@/lib/utils/logger";

/** The site's own hostnames: the configured address and this request's host. */
function siteHostnames(request: NextRequest) {
  const names = new Set<string>();
  try {
    if (process.env.NEXT_PUBLIC_APP_URL)
      names.add(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase());
  } catch {
    // An unparseable setting adds nothing.
  }
  if (request.nextUrl?.hostname) names.add(request.nextUrl.hostname.toLowerCase());
  return [...names];
}

/**
 * Verifies a public form's Turnstile token. With `action`, the token must
 * come from a widget rendered with that action, solved on this site's own
 * hostname (callers without it are checked as before).
 */
export async function verifyPublicTurnstile(
  request: NextRequest,
  token: string,
  logger: Logger,
  options: { action?: string } = {}
) {
  if (process.env.TURNSTILE_SECRET_KEY) {
    const captchaResult = await verifyTurnstileToken({
      token,
      remoteIp: getClientIp(request),
      ...(options.action
        ? { expectedAction: options.action, expectedHostnames: siteHostnames(request) }
        : {}),
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
