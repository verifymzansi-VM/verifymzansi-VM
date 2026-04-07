import { NextResponse, type NextRequest } from "next/server";
import {
  getOwnerColumn,
  normalizeOwnerRecord,
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
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { sendContactFormNotification } from "@/lib/services/email";
import { logAuditEvent } from "@/lib/services/audit";

const log = createLogger("ContactRoute");

type ContactTargetRow = {
  id: string;
  status: string;
  title?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

function isContactTargetRow(record: unknown): record is ContactTargetRow {
  if (!record || typeof record !== "object") {
    return false;
  }

  const candidate = record as Record<string, unknown>;

  return typeof candidate.id === "string" && typeof candidate.status === "string";
}

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

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

    if (!isContactTargetRow(targetRecord)) {
      log.error("Target record shape was invalid", {
        targetType: parsedBody.data.targetType,
        targetId: parsedBody.data.targetId,
      });
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    const normalizedTargetRecord = normalizeOwnerRecord(targetRecord);

    if (normalizedTargetRecord.status !== "live") {
      return NextResponse.json({ error: `${notFoundLabel} not found` }, { status: 404 });
    }

    const targetOwnerId = readOwnerId(normalizedTargetRecord);
    if (!targetOwnerId) {
      log.error("Target record missing owner identifier", {
        targetType: parsedBody.data.targetType,
        targetId: parsedBody.data.targetId,
      });
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Check account verification status
    const { data: accountProfile, error: accountProfileErr } = await admin
      .from("account_profiles")
      .select("account_verification_status, display_name")
      .eq("user_id", targetOwnerId)
      .maybeSingle();

    if (accountProfileErr) {
      log.warn("Failed to fetch account profile for contact event (non-fatal)", {
        targetOwnerId,
        error: accountProfileErr.message,
      });
    }

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
      sender_user_id: user?.id ?? null,
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
        log.error("Leads insert failed", { error: leadsError.message });
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
      }
    }

    // Notify the account holder about the new lead/contact
    try {
      const itemTitle =
        normalizedTargetRecord.title?.slice(0, 40) || `your ${parsedBody.data.targetType}`;

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

    // Send non-blocking owner email alert for new leads.
    try {
      const authAdmin = (
        admin as unknown as {
          auth?: {
            admin?: {
              getUserById?: (id: string) => Promise<{
                data?: { user?: { email?: string | null } | null };
              }>;
            };
          };
        }
      ).auth?.admin;
      const { data: ownerAuthData } = authAdmin?.getUserById
        ? await authAdmin.getUserById(targetOwnerId)
        : { data: { user: { email: null } } };

      const ownerEmail = ownerAuthData?.user?.email;
      if (ownerEmail) {
        const ownerName =
          (accountProfile as { display_name?: string | null } | null)?.display_name || "there";
        const buyerName = user ? "Verified member" : "Interested buyer";
        const buyerEmail = user?.email || "not-provided@verifymzansi.com";
        const inquiryMessage = parsedBody.data.message || "A buyer has requested contact details.";
        const listingTitle = normalizedTargetRecord.title || `your ${parsedBody.data.targetType}`;

        void (async () => {
          const result = await sendContactFormNotification(
            ownerEmail,
            ownerName,
            buyerName,
            buyerEmail,
            inquiryMessage,
            listingTitle
          );

          await logAuditEvent({
            actorId: user?.id || "00000000-0000-0000-0000-000000000000",
            actorRole: user ? "member" : "system",
            action: result.success ? "communication_email_sent" : "communication_email_failed",
            targetType: "account_profile",
            targetId: targetOwnerId,
            metadata: {
              template: "lead_alert",
              channel: "email",
              target_type: parsedBody.data.targetType,
              target_id: parsedBody.data.targetId,
              error: result.error,
              owner_user_id: targetOwnerId,
            },
          });
        })().catch((emailErr) => {
          log.warn("Failed to send contact owner email (non-fatal)", {
            targetType: parsedBody.data.targetType,
            targetId: parsedBody.data.targetId,
            ownerId: targetOwnerId,
            error: emailErr instanceof Error ? emailErr.message : "Unknown",
          });
        });
      }
    } catch (emailLookupErr) {
      log.warn("Failed to resolve contact owner email (non-fatal)", {
        targetType: parsedBody.data.targetType,
        targetId: parsedBody.data.targetId,
        ownerId: targetOwnerId,
        error: emailLookupErr instanceof Error ? emailLookupErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected contact route error", error);
    return internalApiError();
  }
}
