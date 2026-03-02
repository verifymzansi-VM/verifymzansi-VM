import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportSchema } from "@/lib/validations/contact";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { mapLegacyReportValues } from "@/lib/utils/enum-compat";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const log = createLogger("Reports");

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = reportSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // ── CAPTCHA verification ─────────────────────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const turnstileToken = body.turnstileToken;
      if (typeof turnstileToken !== "string") {
        return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
      }
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
      reason: parsed.data.reason,
      targetType: parsed.data.targetType,
    });

    // Use admin client for service-only insert
    const admin = createAdminClient();

    // Compute IP hash for anonymous reports
    const forwardedFor = request.headers.get("x-forwarded-for");
    const sourceIp = forwardedFor?.split(",")[0].trim() || "unknown";
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
      target_id: parsed.data.targetId,
      area,
      category,
      severity: "standard",
      description: parsed.data.description,
      screenshot_url: parsed.data.evidenceUrls?.[0] || null,
      evidence_urls: parsed.data.evidenceUrls?.length ? parsed.data.evidenceUrls : null,
      status: "open",
    });

    if (error) {
      log.error("Report insert error", {
        error: error?.message || "unknown error",
      });
      return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
