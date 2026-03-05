import { type NextRequest, NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { z } from "zod";

const log = createLogger("ResendConfirmation");

const resendSchema = z.object({
  email: z.string().email("Valid email is required"),
});

export async function POST(request: NextRequest) {
  // Rate limit aggressively — this triggers outbound emails
  const ip = getClientIp(request);
  const rateCheck = await checkRateLimit({ key: ip, action: "auth:resend-confirmation" });
  if (rateCheck.limited) {
    return NextResponse.json(
      { error: "Too many requests. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
    );
  }

  const body = await parseJsonRequest(request);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
  });

  if (error) {
    log.warn("Resend confirmation failed", { error: error.message });
  }

  // Always return success to prevent email enumeration — even if the
  // email doesn't exist or is already confirmed, we respond identically.
  return NextResponse.json({
    success: true,
    message: "If an account exists with that email, a new confirmation link has been sent.",
  });
}
