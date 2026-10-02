import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";
import { getPaymentMetadata } from "./types";
import type { PaymentRow, PaymentStoreClient } from "./store";
import { logAuditEvent } from "@/lib/services/audit";
import {
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  type PaymentReceiptDetails,
} from "@/lib/services/email";
import { getAuthAdminUserSummary } from "@/lib/supabase/auth-admin-user";
import { createLogger } from "@/lib/utils/logger";
const log = createLogger("PaymentNotifications");
const SUBSCRIPTION_DURATION_DAYS = 30;

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function getPlanNameFromArea(area?: string | null): string {
  switch (area) {
    case "MZANSI_MARKET":
      return "Mzansi Market";
    case "MZANSI_BUSINESS":
      return "Mzansi Business";
    case "PROMOTIONS_EVENTS":
      return "Tourism & Events";
    default:
      return "VerifyMzansi Plan";
  }
}

const ADDON_LABELS: Record<string, string> = {
  boost: "Listing Boost",
  boost_business: "Business Boost",
  boost_storefront: "Storefront Boost",
  boost_promotion: "Promotion Boost",
  featured: "Featured Listing",
  featured_business: "Featured Business",
  featured_promotion: "Featured Promotion",
  urgent: "Urgent Listing",
  urgent_business: "Urgent Business",
  urgent_promotion: "Urgent Promotion",
};

function getAddonDurationDays(type: string, meta: Record<string, unknown>): number {
  const specific =
    typeof meta.boost_days === "number" && meta.boost_days > 0
      ? meta.boost_days
      : typeof meta.feature_days === "number" && meta.feature_days > 0
        ? meta.feature_days
        : typeof meta.urgent_days === "number" && meta.urgent_days > 0
          ? meta.urgent_days
          : null;
  if (specific !== null) return specific;
  if (type.startsWith("featured")) return FEATURED_DURATION_DAYS;
  if (type.startsWith("urgent")) return URGENT_DURATION_DAYS;
  return BOOST_DURATION_DAYS;
}

/** Receipt wording differs for 30-day plans (no auto-renew) vs one-off add-ons. */
function buildReceiptDetails(payment: PaymentRow): PaymentReceiptDetails {
  const meta = getPaymentMetadata(payment);
  const type = typeof meta?.type === "string" ? meta.type : null;

  if (!type || type === "subscription") {
    // Mirrors the slot window set during fulfillment (payment + plan duration).
    const durationDays =
      typeof meta?.duration_days === "number" && meta.duration_days > 0
        ? meta.duration_days
        : SUBSCRIPTION_DURATION_DAYS;
    return {
      kind: "subscription",
      expiresAt: new Date(
        (payment.created_at ? Date.parse(payment.created_at) : Date.now()) +
          durationDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  }

  return {
    kind: "addon",
    addonName: ADDON_LABELS[type] ?? "Marketplace Add-on",
    durationDays: getAddonDurationDays(type, meta ?? {}),
  };
}

export async function sendPaymentStatusEmail(params: {
  admin: PaymentStoreClient;
  payment: PaymentRow;
  status: "success" | "failed";
  logContext: { paymentId: string; transactionId?: string | null };
}): Promise<void> {
  const recipient = await getAuthAdminUserSummary(params.admin, params.payment.user_id);
  if (recipient.errorMessage || !recipient.email) {
    log.warn("Skipping payment email: recipient lookup failed", {
      ...params.logContext,
      userId: params.payment.user_id,
      error: recipient.errorMessage,
    });
    return;
  }

  const email = recipient.email;
  const accountName = recipient.accountName;
  const amount = params.payment.amount_cents / 100;
  const paymentMeta = getPaymentMetadata(params.payment);
  const planName =
    typeof paymentMeta?.plan_name === "string"
      ? paymentMeta.plan_name
      : getPlanNameFromArea(params.payment.area);

  const result =
    params.status === "success"
      ? await sendPaymentReceiptEmail(
          email,
          accountName,
          amount,
          planName,
          undefined,
          buildReceiptDetails(params.payment)
        )
      : await sendPaymentFailedEmail(email, accountName, amount, planName);

  if (!result.success) {
    log.warn("Payment email delivery failed", {
      ...params.logContext,
      userId: params.payment.user_id,
      status: params.status,
      error: result.error,
    });
  }

  try {
    await logAuditEvent({
      actorId: SYSTEM_ACTOR_ID,
      actorRole: "system",
      action: result.success ? "communication_email_sent" : "communication_email_failed",
      targetType: "account_profile",
      targetId: params.payment.user_id,
      metadata: {
        template: params.status === "success" ? "payment_receipt" : "payment_failed",
        channel: "email",
        error: result.error,
        owner_user_id: params.payment.user_id,
        payment_id: params.logContext.paymentId,
        provider_payment_id: params.payment.provider_payment_id,
        transaction_id: params.logContext.transactionId,
      },
    });
  } catch (auditErr) {
    log.error("Audit log failed (non-fatal)", {
      error: auditErr instanceof Error ? auditErr.message : "Unknown",
    });
  }
}

/** Non-blocking audit log for completed payments. */
export async function auditPaymentCompleted(payment: {
  id: string;
  provider: string;
  amount_cents: number;
  provider_payment_id?: string | null;
  area?: string | null;
}): Promise<void> {
  try {
    await logAuditEvent({
      actorId: SYSTEM_ACTOR_ID,
      actorRole: "system",
      action: "payment_completed",
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: payment.provider,
        amount_cents: payment.amount_cents,
        provider_payment_id: payment.provider_payment_id,
        area: payment.area,
      },
    });
  } catch (auditErr) {
    log.error("Failed to write payment audit log", {
      paymentId: payment.id,
      error: auditErr instanceof Error ? auditErr.message : "Unknown error",
    });
  }
}
