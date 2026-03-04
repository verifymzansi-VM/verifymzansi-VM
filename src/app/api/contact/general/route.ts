import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { z } from "zod";

const log = createLogger("ContactGeneral");

const contactFormSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name cannot exceed 100 characters"),
  email: z.string().email("Enter a valid email address").max(254, "Email is too long"),
  message: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(2000, "Message cannot exceed 2000 characters"),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA"),
});

/**
 * POST /api/contact/general
 *
 * Handles general "Contact Us" form submissions.
 * Validates input, verifies Turnstile CAPTCHA, rate-limits, and stores the inquiry.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // ── Validate input ───────────────────────────────────────
    const parsed = contactFormSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { name, email, message, turnstileToken } = parsed.data;

    // ── CAPTCHA verification ─────────────────────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const forwardedFor = request.headers.get("x-forwarded-for");
      const remoteIp = forwardedFor?.split(",")[0].trim() || undefined;
      const captchaResult = await verifyTurnstileToken({ token: turnstileToken, remoteIp });
      if (!captchaResult.success) {
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "production") {
      log.error("TURNSTILE_SECRET_KEY not configured in production");
      return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
    }

    // ── Rate limit ──────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit({ key: ip, action: "contact:general" });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // ── Sanitize message: strip HTML tags to prevent stored XSS ──
    const sanitizedMessage = message.replace(/<[^>]*>/g, "");

    // ── Store inquiry ────────────────────────────────────────
    const admin = createAdminClient();
    const { error: insertError } = await admin.from("contact_submissions").insert({
      name,
      email,
      message: sanitizedMessage,
      status: "new",
    });

    if (insertError) {
      log.error("Failed to store contact submission", { error: insertError.message });
      return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
    }

    log.info("Contact form submission received", { name, email: email.slice(0, 3) + "***" });

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}
