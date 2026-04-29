import { NextResponse } from "next/server";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { getTurnstileConfigStatus } from "@/lib/utils/turnstile";

export function getPublicAuthTurnstileStatus(request: Request) {
  return getTurnstileConfigStatus({ requestHost: new URL(request.url).hostname });
}

export function enforcePublicAuthTurnstileAvailability(
  request: Request,
  unavailableMessage: string
): NextResponse | null {
  const turnstileStatus = getPublicAuthTurnstileStatus(request);

  if (
    process.env.NODE_ENV === "production" &&
    !turnstileStatus.configured &&
    !isPlaywrightTestMode()
  ) {
    return NextResponse.json({ error: unavailableMessage }, { status: 503 });
  }

  return null;
}
