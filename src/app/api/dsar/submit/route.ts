import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { sendDsarSubmissionEmail } from "@/lib/services/email";
import { dsarRequestSchema } from "@/lib/validations/verification";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";
import { getClientIp, checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("DSAR");
const dsarSubmitSchema = dsarRequestSchema.extend({
  turnstileToken: z.string().min(1, "CAPTCHA verification required"),
});

/**
 * POST /api/dsar/submit
 *
 * Submit a Data Subject Access Request (POPIA Section 23).
 * Accepts requests from both authenticated and anonymous users.
 */
export async function POST(request: NextRequest) {
  try {
    const clientIp = getClientIp(request) || "unknown";
    const rl = checkLocalRateLimit(clientIp, "dsar:submit");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, dsarSubmitSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { type, name, email, idNumber, details, turnstileToken } = parsedBody.data;

    // Per-email rate limit to prevent mass DSAR submissions with different addresses
    const emailRl = checkLocalRateLimit(email.toLowerCase(), "dsar:submit:email");
    if (emailRl.limited) {
      return NextResponse.json(
        { error: "Too many requests for this email address" },
        { status: 429, headers: { "Retry-After": String(emailRl.retryAfter ?? 60) } }
      );
    }

    // Validate ID number format if provided (must be 13 digits for SA ID)
    if (idNumber && !/^\d{13}$/.test(idNumber)) {
      return NextResponse.json({ error: "ID number must be exactly 13 digits" }, { status: 400 });
    }

    // Mask the ID number for safe persistence (show only last 4 digits)
    const maskedId = idNumber ? `*********${idNumber.slice(-4)}` : undefined;

    // ── Turnstile CAPTCHA verification ───────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const remoteIp = getClientIp(request);

      const captchaResult = await verifyTurnstileToken({
        token: turnstileToken,
        remoteIp,
      });

      if (!captchaResult.success) {
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "production") {
      log.error("TURNSTILE_SECRET_KEY not configured in production");
      return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
    }

    // ── Calculate due date (POPIA: 30 days) ──────────────────
    const dueBy = new Date();
    dueBy.setDate(dueBy.getDate() + 30);

    // ── Insert DSAR record ───────────────────────────────────
    const admin = createAdminClient();

    const { data: dsarRecord, error: insertError } = await admin
      .from("dsar_cases")
      .insert({
        type,
        requester_email: email,
        requester_phone: "not_provided",
        identity_verified: false,
        description: [`Name: ${name}`, maskedId ? `ID: ${maskedId}` : null, details || null]
          .filter(Boolean)
          .join(" | "),
        status: "submitted",
        due_by: dueBy.toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      log.error("Insert error", { error: insertError?.message });
      return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
    }

    // ── Audit log ────────────────────────────────────────────
    await logAuditEvent({
      actorId: "00000000-0000-0000-0000-000000000000",
      actorRole: "system",
      action: "dsar_requested",
      targetType: "dsar_case",
      targetId: dsarRecord.id,
      metadata: {
        type,
        requesterEmail: email,
        dueBy: dueBy.toISOString(),
      },
    });

    // Generate a human-readable reference
    const reference = `DSAR-${dsarRecord.id.slice(0, 8).toUpperCase()}`;

    sendDsarSubmissionEmail(email, reference, dueBy.toISOString()).catch((emailError) => {
      log.warn("Failed to send DSAR submission confirmation email", {
        requestId: dsarRecord.id,
        error: emailError instanceof Error ? emailError.message : "unknown error",
      });
    });

    return NextResponse.json({
      success: true,
      requestId: dsarRecord.id,
      reference,
      dueBy: dueBy.toISOString(),
    });
  } catch (error) {
    logApiError(log, "Unexpected DSAR submit error", error);
    return internalApiError("Failed to submit DSAR request");
  }
}
