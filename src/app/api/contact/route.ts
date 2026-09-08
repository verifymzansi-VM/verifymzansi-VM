import { NextResponse, type NextRequest } from "next/server";
import {
  getOwnerColumn,
  normalizeOwnerRecord,
  readAccountVerificationStatus,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactAccountHolderSchema } from "@/lib/validations/contact";
import { mapLegacyContactMethod } from "@/lib/utils/enum-compat";
import { createLogger } from "@/lib/utils/logger";
import { createNotification } from "@/lib/notifications";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { sendContactFormNotification } from "@/lib/services/email";
import { logAuditEvent } from "@/lib/services/audit";
import { enforcePublicMutationPrelude } from "@/lib/utils/public-mutation-route";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { isVisibleByExpiry } from "@/lib/posting/visibility";

const log = createLogger("ContactRoute");

type ContactTargetRow = {
  id: string;
  status: string;
  title?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
  contact_methods?: string[] | null;
  expires_at?: string | null;
  created_at?: string | null;
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
    const parsedBody = await parseAndValidateJsonRequest(request, contactAccountHolderSchema, {
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
      rateLimitAction: "contact:send",
      rateLimitMessage: "Too many contact requests. Please try again later.",
    });
    if (!prelude.success) return prelude.response;

    const { user } = prelude;
    const buyerEmail = parsedBody.data.buyerEmail || user?.email;
    if (!buyerEmail) {
      return NextResponse.json(
        { error: "Provide a reply email so the recipient can respond." },
        { status: 400 }
      );
    }

    // Use admin client for lookups and inserts to bypass RLS on service-only tables
    const admin = createAdminClient();

    const targetTable = parsedBody.data.targetType === "promotion" ? "promotions" : "listings";
    const notFoundLabel =
      parsedBody.data.targetType === "promotion" ? "Tourism & Events post" : "Listing";

    // Get the content owner (use admin client so unauthenticated users can still contact)
    const ownerColumn = await getOwnerColumn(admin, targetTable);
    const { data: targetRecord, error: targetError } = await admin
      .from(targetTable)
      .select(
        withOwnerColumn(
          "id, owner_id, title, status, contact_methods, expires_at, created_at",
          ownerColumn
        )
      )
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

    if (
      normalizedTargetRecord.status !== "live" ||
      !isVisibleByExpiry(
        normalizedTargetRecord.expires_at,
        new Date(),
        normalizedTargetRecord.created_at
      )
    ) {
      return NextResponse.json({ error: `${notFoundLabel} not found` }, { status: 404 });
    }
    const sanitizedMessage = sanitizeUserMessage(parsedBody.data.message);
    if (sanitizedMessage.length < 10 || sanitizedMessage.length > 1000) {
      return NextResponse.json(
        { error: "Message must contain 10–1000 characters after formatting is removed." },
        { status: 400 }
      );
    }

    if (
      normalizedTargetRecord.contact_methods &&
      !normalizedTargetRecord.contact_methods.some(
        (method) => method === "form" || method === "in_app"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "This recipient has not enabled enquiries. Please use the contact options on the post.",
        },
        { status: 403 }
      );
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
      const { error: leadsError } = await admin.from("leads").insert({
        target_id: parsedBody.data.targetId,
        target_type: parsedBody.data.targetType,
        owner_id: targetOwnerId,
        buyer_name: parsedBody.data.buyerName || null,
        buyer_email: buyerEmail,
        buyer_phone: parsedBody.data.buyerPhone
          ? normalizeSaPhone(parsedBody.data.buyerPhone)
          : null,
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

    // Await the email attempt so the server runtime cannot discard it after responding.
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
        const buyerName = parsedBody.data.buyerName || "Interested buyer";
        const inquiryMessage = parsedBody.data.message || "A buyer has requested contact details.";
        const listingTitle = normalizedTargetRecord.title || `your ${parsedBody.data.targetType}`;

        await (async () => {
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
