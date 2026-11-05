import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { sendSupportAcknowledgement, sendSupportRequestNotification } from "@/lib/services/email";
import { logAuditEvent } from "@/lib/services/audit";
import { supportReference } from "@/lib/contact-email";
import {
  emailSchema,
  trimmedStringSchema,
  trimmedTurnstileTokenSchema,
} from "@/lib/validations/shared";
import { z } from "zod";
import { getDataBackend } from "@/lib/data-backend";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";

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
      "organisation_proposal",
      "general_support",
    ])
    .default("general_support"),
  turnstileToken: trimmedTurnstileTokenSchema,
});
async function storeNativeContact(input: z.infer<typeof contactFormSchema>) {
  const service = createFoundationServiceApi();
  const { data, error } = await service.rpc(
    "submit_frontend_support",
    {
      p_name: input.name,
      p_email: input.email,
      p_category: input.category,
      p_message: input.message,
    },
    { get: false }
  );
  if (error?.code === "22023")
    return NextResponse.json({ error: "Check the message details" }, { status: 422 });
  const stored = z
    .strictObject({ id: z.uuid(), reused: z.boolean(), accepted: z.boolean().nullable() })
    .safeParse(data);
  if (error || !stored.success)
    return NextResponse.json({ error: "The message could not be confirmed" }, { status: 503 });
  const receipt = stored.data;
  const record = async (
    template: "support_acknowledgement" | "support_staff_alert",
    send: () => ReturnType<typeof sendSupportAcknowledgement>
  ) => {
    const sent = await send().catch(() => ({ success: false }));
    const activity = await Promise.resolve(
      service.rpc("record_frontend_support_mail", {
        p_ticket: receipt.id,
        p_template: template,
        p_accepted: sent.success,
      })
    ).catch(() => ({ error: true, data: false }));
    if (activity.error || activity.data !== true)
      log.warn("Support email result could not be recorded", { template });
    return sent.success;
  };
  let accepted = receipt.accepted === true;
  if (!receipt.reused) {
    [, accepted] = await Promise.all([
      record("support_staff_alert", () =>
        sendSupportRequestNotification(input.category, receipt.id)
      ),
      record("support_acknowledgement", () =>
        sendSupportAcknowledgement(input.email, receipt.id, input.category)
      ),
    ]);
  }
  return NextResponse.json(
    {
      success: true,
      reference: supportReference(receipt.id),
      acknowledgement: accepted ? "accepted" : "failed",
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

/**
 * POST /api/contact/general
 *
 * Handles general "Contact us" form submissions.
 * Validates input, verifies Turnstile CAPTCHA, rate-limits, and stores the inquiry.
 */
export async function POST(request: NextRequest) {
  try {
    const native = getDataBackend() === "foundation";
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
      const remoteIp = native
        ? getClientIp(request)
        : forwardedFor?.split(",")[0].trim() || undefined;
      const captchaResult = await verifyTurnstileToken({ token: turnstileToken, remoteIp });
      if (native && captchaResult.temporary)
        return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
      if (
        !captchaResult.success ||
        (native &&
          process.env.NODE_ENV === "production" &&
          captchaResult.hostname !==
            new URL(process.env.NEXT_PUBLIC_APP_URL ?? request.url).hostname)
      ) {
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "production") {
      log.error("TURNSTILE_SECRET_KEY not configured in production");
      return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
    }

    // ── Rate limit ──────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: ip,
      action: "contact:general",
      ...(native ? { degradedMode: "block" as const } : {}),
    });
    if (native && rl.degraded)
      return NextResponse.json(
        { error: "Submission protection is temporarily unavailable" },
        { status: 503 }
      );
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Limit acknowledgements per address as well as per IP, without storing the address in rate-limit keys.
    const emailLimit = await checkRateLimit({
      key: `contact-email:${createHash("sha256").update(email.toLowerCase()).digest("hex")}`,
      action: "contact:general",
      degradedMode: "block",
    });
    if (native && emailLimit.degraded)
      return NextResponse.json(
        { error: "Submission protection is temporarily unavailable" },
        { status: 503 }
      );
    if (emailLimit.limited) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailLimit.retryAfter ?? 60) } }
      );
    }
    if (native) return await storeNativeContact(bodyResult.data);

    // ── Sanitize message: escape HTML entities + strip tags to prevent stored XSS ──
    const sanitizedMessage = sanitizeUserMessage(`[${category}] ${message}`);

    // ── Store inquiry ────────────────────────────────────────
    const admin = createAdminClient();
    const submissionId = crypto.randomUUID();
    const { error: insertError } = await admin.from("contact_submissions").insert({
      id: submissionId,
      name,
      email,
      message: sanitizedMessage,
      status: "new",
    });

    if (insertError) {
      log.error("Failed to store contact submission", { error: insertError.message });
      return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
    }

    // The submission is already stored: notification failures must not invite duplicate submissions.
    await notifyStaffForAdminEvent({
      capability: "queue:view",
      title: "New support request submitted",
      message: `${name} submitted a ${category.replace(/_/g, " ")} request.`,
      href: "/admin/support",
    }).catch(() => log.warn("Support request stored but staff notification failed"));

    const recordEmail = async (
      template: string,
      send: () => ReturnType<typeof sendSupportAcknowledgement>
    ) => {
      const result = await send().catch(() => ({ success: false, error: "Email send failed" }));
      await logAuditEvent({
        actorId: "00000000-0000-0000-0000-000000000000",
        actorRole: "system",
        action: result.success ? "communication_email_sent" : "communication_email_failed",
        targetType: "contact_submission",
        targetId: submissionId,
        metadata: {
          template,
          messageId: "messageId" in result ? result.messageId : undefined,
          error: result.error,
        },
      });
      if (!result.success)
        log.warn("Support request stored but email failed", { submissionId, template });
      return result.success;
    };
    const [, acknowledgementAccepted] = await Promise.all([
      recordEmail("support_staff_alert", () =>
        sendSupportRequestNotification(category, submissionId)
      ),
      recordEmail("support_acknowledgement", () =>
        sendSupportAcknowledgement(email, submissionId, category)
      ),
    ]);

    log.info("Contact form submission received", {
      name,
      category,
      email: email.slice(0, 3) + "***",
    });

    return NextResponse.json({
      success: true,
      reference: supportReference(submissionId),
      acknowledgement: acknowledgementAccepted ? "accepted" : "failed",
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}
