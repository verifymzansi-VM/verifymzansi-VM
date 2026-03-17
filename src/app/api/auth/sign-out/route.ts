import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("SignOut");

export async function POST(request: Request) {
  const originBlock = enforceSameOriginMutation(request, log);
  if (originBlock) return originBlock;

  const rl = checkLocalRateLimit(getClientIp(request), "auth:sign-out");
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
    );
  }

  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    log.error("Sign-out error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    // Continue to redirect even if sign-out fails
  }

  return NextResponse.redirect(`${resolveAppOrigin(request)}/`, { status: 302 });
}
