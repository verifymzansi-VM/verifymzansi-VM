import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { dsarRequestSchema } from "@/lib/validations/verification";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("DSAR");

/**
 * POST /api/dsar/submit
 *
 * Submit a Data Subject Access Request (POPIA Section 23).
 * Accepts requests from both authenticated and anonymous users.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // ── Validate input ───────────────────────────────────────
    const parsed = dsarRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { type, name, email, idNumber, details } = parsed.data;

    // Validate ID number format if provided (must be 13 digits for SA ID)
    if (idNumber && !/^\d{13}$/.test(idNumber)) {
      return NextResponse.json({ error: "ID number must be exactly 13 digits" }, { status: 400 });
    }

    // Mask the ID number for safe persistence (show only last 4 digits)
    const maskedId = idNumber ? `*********${idNumber.slice(-4)}` : undefined;

    // ── Turnstile CAPTCHA verification ───────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const turnstileToken = body.turnstileToken;
      if (typeof turnstileToken !== "string") {
        return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
      }

      const forwardedFor = request.headers.get("x-forwarded-for");
      const remoteIp = forwardedFor?.split(",")[0].trim() || undefined;

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
      actorRole: "admin",
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

    return NextResponse.json({
      success: true,
      requestId: dsarRecord.id,
      reference,
      dueBy: dueBy.toISOString(),
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Failed to submit DSAR request" }, { status: 500 });
  }
}
