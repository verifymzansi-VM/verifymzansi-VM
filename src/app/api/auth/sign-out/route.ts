import { createClient } from "@/lib/supabase/server";
import { type NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";
import { checkLocalRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";

const log = createLogger("SignOut");

export async function POST(request: NextRequest) {
  const originBlock = enforceSameOriginMutation(request, log);
  if (originBlock) return originBlock;

  const csrfBlock = enforceCsrfToken(request, log);
  if (csrfBlock) return csrfBlock;

  const rl = checkLocalRateLimit(getClientIp(request), "auth:sign-out");
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
    );
  }

  try {
    const supabase = await createClient();
    // Use global scope to invalidate all sessions across devices,
    // preventing stolen refresh tokens from remaining valid.
    await supabase.auth.signOut({ scope: "global" });
  } catch (err) {
    log.error("Sign-out error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to sign out. Please try again." }, { status: 503 });
  }

  const response = NextResponse.redirect(`${resolveAppOrigin(request)}/`, { status: 302 });
  response.cookies.delete("x-phone-ok");
  return response;
}
