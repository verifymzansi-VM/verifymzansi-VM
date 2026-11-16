import { NextResponse, type NextRequest } from "next/server";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { getClientIp } from "@/lib/utils/rate-limit";
import type { Logger } from "@/lib/utils/logger";

export async function verifyPublicTurnstile(request: NextRequest, token: string, logger: Logger) {
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
