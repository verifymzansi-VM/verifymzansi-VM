import { NextResponse, type NextRequest } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import {
  emailSchema,
  trimmedStringSchema,
  trimmedTurnstileTokenSchema,
} from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("ContactGeneral");

const contactFormSchema = z.object({
  name: trimmedStringSchema.pipe(
    z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters")
  ),
  email: trimmedStringSchema.pipe(emailSchema),
  message: trimmedStringSchema.pipe(
    z
      .string()
      .min(10, "Message must be at least 10 characters")
      .max(2000, "Message cannot exceed 2000 characters")
  ),
  category: z
    .enum([
      "fraud_report",
      "verification_appeal",
      "privacy_popia",
      "payment_refund",
      "security_vulnerability",
      "business_claim",
      "general_support",
    ])
    .default("general_support"),
  turnstileToken: trimmedTurnstileTokenSchema,
});

/**
 * POST /api/contact/general
 *
 * Handles general "Contact Us" form submissions.
 * Validates input, verifies Turnstile CAPTCHA, rate-limits, and stores the inquiry.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const bodyResult = await parseAndValidateJsonRequest(request, contactFormSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid input",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { name, email, category, message, turnstileToken } = bodyResult.data;

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

    // ── Sanitize message: escape HTML entities + strip tags to prevent stored XSS ──
    const sanitizedMessage = sanitizeUserMessage(`[${category}] ${message}`);

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

    log.info("Contact form submission received", {
      name,
      category,
      email: email.slice(0, 3) + "***",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}
