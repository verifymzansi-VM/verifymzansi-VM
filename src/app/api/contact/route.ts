import { NextResponse, type NextRequest } from "next/server";
import {
  getOwnerColumn,
  readAccountVerificationStatus,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactAccountHolderSchema } from "@/lib/validations/contact";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { mapLegacyContactMethod } from "@/lib/utils/enum-compat";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createNotification } from "@/lib/notifications";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";

const log = createLogger("ContactRoute");

export async function POST(request: NextRequest) {
  try {
    const parsedBody = await parseAndValidateJsonRequest(request, contactAccountHolderSchema, {
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

    // Rate limit by IP (or user ID if authenticated)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimitKey = user?.id || getClientIp(request) || "unknown";
    const rl = await checkRateLimit({ key: rateLimitKey, action: "contact:send" });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many contact requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Use admin client for lookups and inserts to bypass RLS on service-only tables
    const admin = createAdminClient();

    const targetTable = parsedBody.data.targetType === "promotion" ? "promotions" : "listings";
    const notFoundLabel = parsedBody.data.targetType === "promotion" ? "Promotion" : "Listing";

    // Get the content owner (use admin client so unauthenticated users can still contact)
    const ownerColumn = await getOwnerColumn(admin, targetTable);
    const { data: targetRecord, error: targetError } = await admin
      .from(targetTable)
      .select(withOwnerColumn("owner_id, title, status", ownerColumn))
      .eq("id", parsedBody.data.targetId)
      .maybeSingle();

    if (targetError || !targetRecord) {
      return NextResponse.json({ error: `${notFoundLabel} not found` }, { status: 404 });
    }

    if (targetRecord.status !== "live") {
      return NextResponse.json({ error: `${notFoundLabel} not found` }, { status: 404 });
    }

    const targetOwnerId = readOwnerId(targetRecord);
    if (!targetOwnerId) {
      log.error("Target record missing owner identifier", {
        targetType: parsedBody.data.targetType,
        targetId: parsedBody.data.targetId,
      });
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Check account verification status
    const { data: accountProfile } = await admin
      .from("account_profiles")
      .select("account_verification_status")
      .eq("user_id", targetOwnerId)
      .maybeSingle();

    const ownerVerified = readAccountVerificationStatus(accountProfile) === "verified";

    // Map legacy contactMethod values to canonical contact_type
    const contactType = mapLegacyContactMethod(parsedBody.data.contactMethod);

    // Create canonical contact_events record
    const { error: contactError } = await admin.from("contact_events").insert({
      target_id: parsedBody.data.targetId,
      target_type: parsedBody.data.targetType,
      owner_id: targetOwnerId,
      member_verified: ownerVerified,
      contact_type: contactType,
    });

    if (contactError) {
      log.error("Contact event insert error", { error: contactError.message });
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Create leads row for buyer message content
    if (parsedBody.data.message) {
      // Sanitize message: escape HTML entities + strip tags to prevent stored XSS
      const sanitizedMessage = sanitizeUserMessage(parsedBody.data.message);
      const { error: leadsError } = await admin.from("leads").insert({
        target_id: parsedBody.data.targetId,
        target_type: parsedBody.data.targetType,
        owner_id: targetOwnerId,
        buyer_name: null,
        buyer_email: user?.email || null,
        buyer_phone: null,
        message: sanitizedMessage,
        status: "new",
      });

      if (leadsError) {
        log.error("Leads insert failed (non-fatal)", { error: leadsError.message });
      }
    }

    // Notify the account holder about the new lead/contact
    try {
      const itemTitle = targetRecord.title?.slice(0, 40) || `your ${parsedBody.data.targetType}`;

      await createNotification({
        userId: targetOwnerId,
        type: "info",
        title: "New lead received!",
        message: `Someone is interested in "${itemTitle}".`,
        href: "/dashboard/leads",
      });
    } catch {
      // Non-fatal — contact was already created successfully
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected contact route error", error);
    return internalApiError();
  }
}
