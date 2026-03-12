import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { changePasswordSchema } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ChangePassword");

export async function POST(request: NextRequest) {
  // Rate limit by IP
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "auth:change-password" });
  if (rateCheck.limited) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
    );
  }

  // Authenticate
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // Parse and validate
  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Verify current password by attempting sign-in.
  // NOTE: signInWithPassword() refreshes the current session as a side-effect.
  // This is acceptable because the user is already authenticated; the session
  // simply gets a new token pair. Supabase does not expose a dedicated
  // "verify password" endpoint, so this is the standard approach.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });

  if (signInError) {
    log.warn("Password change failed: incorrect current password", { userId: user.id });
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  // Update to new password
  const { error: updateError } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });

  if (updateError) {
    log.error("Password update failed", { userId: user.id, error: updateError.message });
    return NextResponse.json(
      { error: "Failed to update password. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
