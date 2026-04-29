import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportSchema } from "@/lib/validations/contact";
import { mapLegacyReportValues } from "@/lib/utils/enum-compat";
import crypto from "crypto";
import { createLogger } from "@/lib/utils/logger";
import { getClientIp } from "@/lib/utils/rate-limit";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { enforcePublicMutationPrelude } from "@/lib/utils/public-mutation-route";

const log = createLogger("Reports");

/** Stable per-startup fallback key for dev — avoids regenerating on every request. */
const DEV_IP_HASH_FALLBACK_KEY = crypto.randomBytes(32).toString("hex");

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

    const prelude = await enforcePublicMutationPrelude({
      request,
      logger: log,
      turnstileToken: parsedBody.data.turnstileToken,
      rateLimitAction: "report:submit",
      rateLimitMessage: "Too many reports submitted. Please try again later.",
    });
    if (!prelude.success) return prelude.response;

    const { user } = prelude;

    // Map legacy request values to canonical DB enums
    const { category, targetType, area } = mapLegacyReportValues({
      reason: parsedBody.data.reason,
      targetType: parsedBody.data.targetType,
    });

    // Use admin client for service-only insert
    const admin = createAdminClient();

    // Compute IP hash for anonymous reports
    const sourceIp = getClientIp(request) || "unknown";
    const hmacKey = process.env.IP_HASH_SECRET;
    if (!hmacKey) {
      if (process.env.NODE_ENV === "production") {
        log.error("IP_HASH_SECRET not configured");
        return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
      }
      log.warn("IP_HASH_SECRET not set — using random per-startup key (dev only)");
    }
    const ipHash = crypto
      .createHmac("sha256", hmacKey || DEV_IP_HASH_FALLBACK_KEY)
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
      description: parsedBody.data.description
        ? sanitizeUserMessage(parsedBody.data.description)
        : null,
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

    void notifyStaffForAdminEvent({
      capability: "queue:view",
      title: "New report submitted",
      message: "A new report is waiting in the reports queue.",
      href: "/admin/reports",
      excludeUserId: user?.id ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected report route error", error);
    return internalApiError();
  }
}
