import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportSchema } from "@/lib/validations/contact";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { mapLegacyReportValues } from "@/lib/utils/enum-compat";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("Reports");

export async function POST(request: NextRequest) {
  try {
    const parsedBody = await parseAndValidateJsonRequest(request, reportSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    // ── CAPTCHA verification ─────────────────────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const remoteIp = getClientIp(request);
      const captchaResult = await verifyTurnstileToken({
        token: parsedBody.data.turnstileToken,
        remoteIp,
      });
      if (!captchaResult.success) {
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "production") {
      log.error("TURNSTILE_SECRET_KEY not configured in production");
      return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Rate limit by user ID or IP to prevent report spam
    const rateLimitKey = user?.id || getClientIp(request) || "unknown";
    const rl = await checkRateLimit({ key: rateLimitKey, action: "report:submit" });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many reports submitted. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Map legacy request values to canonical DB enums
    const { category, targetType, area } = mapLegacyReportValues({
      reason: parsedBody.data.reason,
      targetType: parsedBody.data.targetType,
    });

    // Use admin client for service-only insert
    const admin = createAdminClient();

    // Compute IP hash for anonymous reports
    const sourceIp = getClientIp(request);
    const hmacKey = process.env.IP_HASH_SECRET;
    if (!hmacKey) {
      if (process.env.NODE_ENV === "production") {
        log.error("IP_HASH_SECRET not configured");
        return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
      }
      // In development, use a dev-only fallback
    }
    const ipHash = crypto
      .createHmac("sha256", hmacKey || "dev-only-fallback-not-for-production")
      .update(sourceIp)
      .digest("hex");

    const { error } = await admin.from("reports").insert({
      reporter_user_id: user?.id || null,
      reporter_ip_hash: ipHash,
      target_type: targetType,
      target_id: parsedBody.data.targetId,
      area,
      category,
      severity: "standard",
      description: parsedBody.data.description,
      screenshot_url: parsedBody.data.evidenceUrls?.[0] || null,
      evidence_urls: parsedBody.data.evidenceUrls?.length ? parsedBody.data.evidenceUrls : null,
      status: "open",
    });

    if (error) {
      log.error("Report insert error", {
        error: error?.message || "unknown error",
      });
      return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected report route error", error);
    return internalApiError();
  }
}
