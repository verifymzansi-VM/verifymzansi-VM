import { Resend } from "resend";
import {
  CONTACT_CATEGORY_EMAILS,
  SUPPORT_CONTACT_EMAIL,
  supportReference,
} from "@/lib/contact-email";
import { createLogger } from "@/lib/utils/logger";
import {
  brandedEmail,
  detailList,
  escapeHtml,
  isSafeHttpUrl,
  messageBox,
  noteBox,
  paragraph,
  sanitizeAppUrl,
} from "@/lib/services/email-template";
import { buildPaymentReceiptEmail, type PaymentReceipt } from "./payment-receipt-email";

const log = createLogger("Email");

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM_EMAIL = "VerifyMzansi <noreply@verifymzansi.com>";

const platformNotices = {
  business_check_update: [
    "Business verification update",
    "There is an update on one of your business checks. Sign in to see the current details.",
  ],
  account_warning: [
    "Account warning",
    "A staff warning has been recorded on your VerifyMzansi account.",
  ],
  content_hidden: [
    "Content hidden after review",
    "A post on your account was hidden. Review the decision and your options.",
  ],
  account_suspended: [
    "Account suspension",
    "A suspension has been recorded. Sign in to see the current decision and when it ends.",
  ],
  account_banned: [
    "Account ban",
    "A ban has been recorded. Sign in to see the decision and your appeal options.",
  ],
  appeal_decided: [
    "Your appeal has been decided",
    "An independent reviewer has decided your appeal. Sign in to read the outcome.",
  ],
  // Sent only when the receipt details cannot be read; the receipt itself is
  // built in ./payment-receipt-email.ts.
  payment_completed: [
    "Payment received",
    "We received your payment. Need your invoice? Reply to this email.",
  ],
  payment_reversed: [
    "Payment update",
    "A payment reversal has been recorded. Review the current details in Billing.",
  ],
  payment_reconciliation_required: [
    "Payment review in progress",
    "A payment needs reconciliation. Its current status is available in Billing.",
  ],
  trial_started: [
    "Your introductory posting allowance is ready",
    "Your eligible introductory allowance is now recorded on your account.",
  ],
  // The three post lifecycle notices below are worded with the deletion date
  // when the notification job knows it (postLifecycleIntro); these texts are
  // the fallback without a date.
  post_expired: [
    "Your post has expired",
    "One of your posts is no longer shown because the plan that paid for it has ended or was cancelled. Buy a plan and reactivate it from your posts to keep it; otherwise it will be deleted, with its photos and videos.",
  ],
  post_sold: [
    "Your post is marked as sold",
    "You marked one of your posts as sold. It will be deleted, with its photos and videos, shortly. Marked it by mistake? Reactivate it from your posts soon.",
  ],
  post_kept: [
    "Your post is kept after your payment",
    "Your payment is confirmed, so your expired post is kept for a few more days. Reactivate it from your posts to show it again.",
  ],
  post_expiry_reminder: [
    "A post is approaching its visibility end date",
    "Review your posts and posting allowance before its visibility period ends.",
  ],
  draft_deletion_warning: [
    "A saved draft needs attention",
    "An old draft is approaching the retention limit. Review your saved posts.",
  ],
  post_deleted: [
    "Post deleted",
    "A post was deleted from your account. You can review your remaining posts in the dashboard.",
  ],
  verification_phone_confirmed: [
    "Mobile number verified",
    "Your mobile verification has been recorded. Review any remaining verification steps.",
  ],
  identity_accepted: [
    "Identity review completed",
    "Your identity documents have been reviewed. Your current status is available on the verification page.",
  ],
  enquiry_received: [
    "New enquiry",
    "A member sent you an enquiry. Sign in to read it and manage the conversation.",
  ],
  // Says only that the ID was sent back: the reviewer's reason and any identity
  // details stay on the verification page, behind sign-in.
  verification_returned: [
    "Your ID check needs another look",
    "We could not complete your ID check, so we have sent it back to you. Sign in and open the verification page to see why and what to do next.",
  ],
  // Renew early (P3), 3 days before a slot ends; worded with its end date when
  // the notification job knows it (postLifecycleIntro). Wording awaiting the
  // owner's approval.
  slot_renewal_reminder: [
    "Your slot ends soon",
    "One of your Individual slots ends within 3 days. Renew it now and your new days start when the current ones end, so your post stays live without a break.",
  ],
} as const;
export type PlatformNoticeKind = keyof typeof platformNotices;
/** The renewal reminder's second paragraph (awaiting the owner's approval). */
const RENEWAL_REMINDER_BODY =
  "Nothing renews automatically. If you do not renew, the post in this slot is hidden when the slot ends and deleted 3 days later, with its photos and videos.";
/** What the notification job knows about the post a lifecycle notice is about,
 * or, for trial_started, when the introductory trial ends and whether it
 * already pays for a post (a staff or service grant does not), or, for
 * payment_completed, the payment's receipt. */
export type PostLifecycleDetails = {
  deletesAt?: string | null;
  holdsSlot?: boolean | null;
  trialEndsAt?: string | null;
  trialFundsPost?: boolean | null;
  receipt?: PaymentReceipt;
  /** slot_renewal_reminder: the slot that ends, when, and whether more than
   * one slot ends within 7 days (the email then offers "Renew all"). */
  renewSlotId?: string | null;
  slotEndsAt?: string | null;
  slotRenewAll?: boolean | null;
};
function deletionTime(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
}
function postLifecycleIntro(kind: PlatformNoticeKind, details?: PostLifecycleDetails) {
  if (kind === "trial_started") {
    // The trial starts when the member's first post is approved; a staff or
    // service grant starts at once and pays for no post yet.
    const ends = deletionTime(details?.trialEndsAt);
    if (!ends) return null;
    return details?.trialFundsPost === true
      ? `Your free introductory post is live until ${ends} (South African time). After that, buy a plan within 3 days to reactivate it, or it is deleted with its photos and videos.`
      : `Your introductory posting allowance runs until ${ends} (South African time).`;
  }
  if (kind === "slot_renewal_reminder") {
    const ends = deletionTime(details?.slotEndsAt);
    if (!ends) return null;
    return details?.slotRenewAll
      ? `Your Individual slot ends on ${ends} (South African time), and another of your slots ends within 7 days. Renew them together in one payment: each slot's new days start when its current days end, so your posts stay live without a break.`
      : `Your Individual slot ends on ${ends} (South African time). Renew it now and your new days start when the current ones end, so your post stays live without a break.`;
  }
  const when = deletionTime(details?.deletesAt);
  if (!when) return null;
  if (kind === "post_expired")
    return `One of your posts is no longer shown because the plan that paid for it has ended or was cancelled. It will be deleted, with its photos and videos, on ${when} (South African time). To keep it, buy a plan and reactivate it from your posts before then.`;
  if (kind === "post_sold")
    return `You marked one of your posts as sold. It will be deleted, with its photos and videos, on ${when} (South African time).${details?.holdsSlot ? " Its plan slot stays in use until then; delete the post yourself to free the slot sooner." : ""} Marked it by mistake? Reactivate it from your posts before then.`;
  if (kind === "post_kept")
    return `Your payment is confirmed, so your expired post is kept until ${when} (South African time). Reactivate it from your posts before then to show it again; otherwise it will be deleted, with its photos and videos.`;
  return null;
}
export async function sendPlatformNotice(
  to: string,
  kind: PlatformNoticeKind,
  idempotencyKey: string,
  noticeReason?: string,
  details?: PostLifecycleDetails
): Promise<SendEmailResult> {
  if (
    kind === "account_warning" &&
    (!noticeReason || noticeReason.length < 10 || noticeReason.length > 500)
  )
    throw new Error("Account warning details unavailable");
  if (kind === "payment_completed" && details?.receipt)
    return sendEmail({ to, idempotencyKey, ...buildPaymentReceiptEmail(details.receipt) });
  const [subject, fallbackIntro] = platformNotices[kind];
  const intro = postLifecycleIntro(kind, details) ?? fallbackIntro;
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const moderation = [
    "content_hidden",
    "account_suspended",
    "account_banned",
    "appeal_decided",
  ].includes(kind);
  // The renewal reminder links to the renewal checkout: that slot, or every
  // slot ending within 7 days ("Renew all").
  const renewal = kind === "slot_renewal_reminder";
  const renewPath = details?.slotRenewAll
    ? "/billing/checkout?renew=soon"
    : details?.renewSlotId && /^[0-9a-f-]{36}$/i.test(details.renewSlotId)
      ? `/billing/checkout?renew=${details.renewSlotId}`
      : "/dashboard/slots";
  const path =
    kind === "business_check_update"
      ? "/dashboard/businesses"
      : moderation
        ? "/appeals"
        : kind === "payment_completed"
          ? "/dashboard"
          : kind.startsWith("payment_")
            ? "/billing"
            : kind === "enquiry_received"
              ? "/dashboard/leads"
              : kind === "identity_accepted" ||
                  kind === "verification_phone_confirmed" ||
                  kind === "verification_returned"
                ? "/verification"
                : renewal
                  ? renewPath
                  : "/dashboard";
  const body =
    kind === "account_warning"
      ? noticeReason!
      : renewal
        ? RENEWAL_REMINDER_BODY
        : "Sign in to your account to view the details.";
  const cta = renewal
    ? details?.slotRenewAll
      ? "Renew all"
      : "Renew my slot"
    : "View your account";
  return sendEmail({
    to,
    subject,
    idempotencyKey,
    html: brandedEmail({
      title: subject,
      intro,
      bodyHtml: paragraph(body),
      cta: { label: cta, href: appUrl + path },
      reason: "This is an operational update about your VerifyMzansi account.",
    }),
    text: `${subject}\n\n${intro}${kind === "account_warning" || renewal ? `\n\n${body}` : ""}\n\n${renewal ? `${cta}: ` : "Sign in to view the details: "}${appUrl}${path}`,
  });
}

interface SendEmailParams {
  idempotencyKey?: string;
  replyTo?: string;
  /** One address, or a few staff addresses that all see each other. */
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** The provider refused a repeat of an earlier request with the same key
   * (still in progress, or sent with different content). That earlier request
   * may have been delivered, so this is not a refusal of the email. */
  outcomeUnknown?: boolean;
}

const EMAIL_MAX_RETRIES = 2;
const EMAIL_BASE_DELAY_MS = 1_000;
// Three attempts plus backoff fit inside Workers' 30-second background window.
const EMAIL_TIMEOUT_MS = 8_000;

function isRetryableEmailError(error: unknown): boolean {
  if (error instanceof Error && ["AbortError", "EmailTimeoutError"].includes(error.name))
    return true;
  if (error instanceof TypeError) return true;
  return false;
}

function isRetryableProviderError(error: {
  statusCode?: number | null;
  name?: string;
  message?: string;
}): boolean {
  if (typeof error.statusCode === "number") {
    return error.statusCode === 429 || error.statusCode >= 500;
  }
  return (
    ["rate_limit_exceeded", "internal_server_error", "application_error"].includes(
      error.name ?? ""
    ) || /rate.?limit|\b429\b|\b5\d{2}\b/i.test(error.message ?? "")
  );
}

// HTTP 409 for an idempotency key that was already used: a retry after a
// timeout while the first request is still in progress, or the same key with
// different content (for example a lifecycle notice whose dates changed).
function isRepeatedRequestError(error: { statusCode?: number | null; name?: string }): boolean {
  return (
    error.statusCode === 409 ||
    error.name === "concurrent_idempotent_requests" ||
    error.name === "invalid_idempotent_request"
  );
}

async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (process.env.NODE_ENV === "development") {
    log.warn("Mock email sending", { subject: params.subject });
    return {
      success: true,
      messageId: "mock-" + Date.now(),
    };
  }

  let lastError: string | undefined;
  // Reuse across retries: a timeout does not mean the provider rejected the first send.
  const idempotencyKey = params.idempotencyKey || crypto.randomUUID();
  const payload = {
    from: FROM_EMAIL,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    replyTo:
      params.replyTo || process.env.VERIFYMZANSI_SUPPORT_EMAIL?.trim() || SUPPORT_CONTACT_EMAIL,
  };

  for (let attempt = 0; attempt <= EMAIL_MAX_RETRIES; attempt++) {
    try {
      const sendPromise = getResend().emails.send(payload, { idempotencyKey });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error("Email send timed out");
            error.name = "EmailTimeoutError";
            reject(error);
          }, EMAIL_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));

      if (result.error) {
        lastError = result.error.message;
        if (isRetryableProviderError(result.error) && attempt < EMAIL_MAX_RETRIES) {
          const backoff = EMAIL_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn("Resend transient error, retrying", {
            attempt: attempt + 1,
            error: result.error.message,
            nextDelayMs: backoff,
          });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        if (isRepeatedRequestError(result.error)) {
          log.warn("Resend refused a repeated request; outcome unknown", {
            error: result.error.name,
          });
          return { success: false, error: result.error.message, outcomeUnknown: true };
        }
        log.error("Resend error", { error: result.error });
        return { success: false, error: result.error.message };
      }

      if (!result.data?.id) {
        log.error("Resend returned no message ID");
        return { success: false, error: "Email provider returned no message ID" };
      }
      return {
        success: true,
        messageId: result.data?.id,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Email sending failed";
      if (isRetryableEmailError(error) && attempt < EMAIL_MAX_RETRIES) {
        const backoff = EMAIL_BASE_DELAY_MS * Math.pow(2, attempt);
        log.warn("Email send error, retrying", {
          attempt: attempt + 1,
          error: lastError,
          nextDelayMs: backoff,
        });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      log.error("Send error", { error: lastError });
      return { success: false, error: lastError };
    }
  }

  return { success: false, error: lastError ?? "Email sending failed after retries" };
}

export async function sendVerificationApprovedEmail(
  email: string,
  accountName: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "Your VerifyMzansi ID has been reviewed";
  const html = brandedEmail({
    tone: "success",
    eyebrow: "Verification complete",
    title: "Your ID has been reviewed",
    intro: "Our team has reviewed your phone, ID and selfie. You can now post on VerifyMzansi.",
    bodyHtml: `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph("Good news. Our team has reviewed your details and your account now shows the ID reviewed sticker.")}
      <p>You can now:</p>
      <ul>
        <li>Post products and rentals on Mzansi Market</li>
        <li>Set up a business profile on Mzansi Business</li>
        <li>Post stays, experiences and events on Tourism &amp; Events</li>
        <li>Ask for the CIPC registered or Seen by VerifyMzansi sticker for your business</li>
      </ul>
      ${paragraph("Thank you for choosing VerifyMzansi.")}
    `,
    cta: { label: "Go to dashboard", href: `${appUrl}/dashboard`, tone: "success" },
    reason: "Your account verification status changed on VerifyMzansi.",
  });

  const text = `Hi ${accountName},

Good news. Our team has reviewed your phone, ID and selfie, and your account now shows the ID reviewed sticker.

You can now post on Mzansi Market, Mzansi Business and Tourism & Events, and ask for the CIPC registered or Seen by VerifyMzansi sticker for your business.

Go to dashboard: ${appUrl}/dashboard

This email was sent because your account verification status changed on VerifyMzansi.

Thank you for choosing VerifyMzansi.`;

  return sendEmail({ to: email, subject, html, text });
}

export async function sendVerificationRejectedEmail(
  email: string,
  accountName: string,
  reason: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi Verification Update";
  const html = brandedEmail({
    tone: "danger",
    eyebrow: "Verification update",
    title: "Verification review required",
    intro: "This email is about your latest VerifyMzansi verification submission.",
    bodyHtml: `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph("We reviewed your verification submission and need you to resubmit some information.")}
      ${detailList([["Reason", reason]])}
      ${paragraph("Please review the requirements and submit your verification again.")}
    `,
    cta: { label: "Resubmit verification", href: `${appUrl}/verification`, tone: "danger" },
    reason: "Your verification submission needs updated information before it can be approved.",
  });

  const text = `Hi ${accountName},\n\nWe reviewed your verification submission and need you to resubmit some information.\n\nReason: ${reason}\n\nResubmit verification: ${appUrl}/verification\n\nThis email was sent because your verification submission needs updated information.`;

  return sendEmail({ to: email, subject, html, text });
}

export async function sendVerificationResubmissionEmail(
  email: string,
  accountName: string,
  reason: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi verification resubmission required";
  const html = brandedEmail({
    tone: "warning",
    eyebrow: "Verification resubmission",
    title: "Updated information is needed",
    intro: "This email explains what to update so we can continue your VerifyMzansi review.",
    bodyHtml: `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph("We reviewed your verification submission and need updated information before we can continue.")}
      ${detailList([["What to fix", reason]])}
      ${paragraph("If you need help, reply to this email and our support team will assist you.")}
    `,
    cta: { label: "Update verification", href: `${appUrl}/verification`, tone: "warning" },
    reason: "Your verification submission requires a resubmission from your VerifyMzansi account.",
  });

  const text = `Hi ${accountName},\n\nWe reviewed your verification submission and need updated information.\n\nWhat to fix: ${reason}\n\nUpdate verification: ${appUrl}/verification\n\nIf you need help, reply to this email.`;

  return sendEmail({ to: email, subject, html, text });
}

export type PaymentReceiptDetails = {
  /** "subscription" (default) for 30-day plans; "addon" for one-off purchases. */
  kind?: "subscription" | "addon";
  /** ISO timestamp of subscription expiry — plans end, they do not auto-renew. */
  expiresAt?: string | null;
  /** Human-readable add-on name (e.g. "Listing Boost") for add-on receipts. */
  addonName?: string;
  /** Add-on active duration in days. */
  durationDays?: number;
};

function formatReceiptDate(isoDate: string): string | null {
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export async function sendPaymentReceiptEmail(
  email: string,
  accountName: string,
  amount: number,
  planName: string,
  invoiceUrl?: string,
  details?: PaymentReceiptDetails
): Promise<SendEmailResult> {
  const isAddon = details?.kind === "addon";
  const itemName = isAddon ? (details?.addonName ?? planName) : planName;
  const subject = isAddon ? `Payment Receipt - ${itemName}` : `Payment Receipt - ${planName}`;
  const safeInvoiceUrl = isSafeHttpUrl(invoiceUrl) ? invoiceUrl : undefined;
  const invoiceButton = isSafeHttpUrl(invoiceUrl)
    ? { label: "Download invoice", href: invoiceUrl, tone: "info" as const }
    : undefined;

  let bodyHtml: string;
  let textBody: string;

  if (isAddon) {
    const durationDays =
      typeof details?.durationDays === "number" && details.durationDays > 0
        ? details.durationDays
        : null;
    bodyHtml = `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph(`Thank you for your payment. Your ${itemName} is now active.`)}
      ${detailList([
        ["Add-on", itemName],
        ["Amount", `R ${amount.toFixed(2)}`],
        ["Status", "Active"],
        ...(durationDays !== null
          ? ([["Duration", `${durationDays} days`]] as [string, string][])
          : []),
      ])}
      ${paragraph("This add-on is a one-time purchase and does not renew.")}
    `;
    textBody = `Hi ${accountName},\n\nThank you for your payment. Your ${itemName} is now active.\n\nAdd-on: ${itemName}\nAmount: R ${amount.toFixed(2)}\nStatus: Active${durationDays !== null ? `\nDuration: ${durationDays} days` : ""}${safeInvoiceUrl ? `\nInvoice: ${safeInvoiceUrl}` : ""}\n\nThis add-on is a one-time purchase and does not renew.\n\nThis receipt was sent because a payment was processed for your VerifyMzansi account.`;
  } else {
    const expiryDate = details?.expiresAt ? formatReceiptDate(details.expiresAt) : null;
    const activeUntilLine = expiryDate
      ? `Your plan is active until ${expiryDate}.`
      : "Your plan is active from the payment date for its purchased period.";
    bodyHtml = `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph(`Thank you for your payment. ${activeUntilLine}`)}
      ${detailList([
        ["Plan", planName],
        ["Amount", `R ${amount.toFixed(2)}`],
        ["Status", "Active"],
        ...(expiryDate ? ([["Active until", expiryDate]] as [string, string][]) : []),
      ])}
      ${paragraph("Plans do not auto-renew. When your plan ends, its posts are hidden and deleted 3 days later unless you buy a new plan and reactivate them.")}
    `;
    textBody = `Hi ${accountName},\n\nThank you for your payment. ${activeUntilLine}\n\nPlan: ${planName}\nAmount: R ${amount.toFixed(2)}\nStatus: Active${expiryDate ? `\nActive until: ${expiryDate}` : ""}${safeInvoiceUrl ? `\nInvoice: ${safeInvoiceUrl}` : ""}\n\nPlans do not auto-renew. When your plan ends, its posts are hidden and deleted 3 days later unless you buy a new plan and reactivate them.\n\nThis receipt was sent because a payment was processed for your VerifyMzansi account.`;
  }

  const html = brandedEmail({
    tone: "success",
    eyebrow: "Payment receipt",
    title: "Payment received",
    intro: "This receipt confirms a payment was processed for your VerifyMzansi account.",
    bodyHtml,
    cta: invoiceButton,
    reason: "A payment was processed for your VerifyMzansi account.",
  });

  return sendEmail({ to: email, subject, html, text: textBody });
}

export async function sendPaymentFailedEmail(
  email: string,
  accountName: string,
  amount: number,
  planName: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = `Payment failed - ${planName}`;
  const html = brandedEmail({
    tone: "danger",
    eyebrow: "Billing update",
    title: "Payment could not be completed",
    intro: "This email lets you know that a VerifyMzansi payment did not go through.",
    bodyHtml: `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph("We could not process your payment. Your plan has not been activated yet.")}
      ${detailList([
        ["Plan", planName],
        ["Amount", `R ${amount.toFixed(2)}`],
      ])}
      ${paragraph("If you believe this is an error, contact support and include your account email.")}
    `,
    cta: { label: "Retry payment", href: `${appUrl}/billing`, tone: "danger" },
    reason: "A payment attempt for your VerifyMzansi account was unsuccessful.",
  });

  const text = `Hi ${accountName},\n\nWe could not process your payment for ${planName}.\nAmount: R ${amount.toFixed(2)}\n\nRetry payment: ${appUrl}/billing\n\nIf you believe this is an error, please contact support.`;

  return sendEmail({ to: email, subject, html, text });
}

export async function sendDsarSubmissionEmail(
  email: string,
  reference: string,
  dueByIso: string,
  idempotencyKey?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const dueDate = new Date(dueByIso).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Johannesburg",
  });
  const subject = `VerifyMzansi data request received (${reference})`;
  const html = brandedEmail({
    tone: "neutral",
    eyebrow: "Data request",
    title: "Data request received",
    intro: "This email confirms we received your VerifyMzansi data request.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("We have received your VerifyMzansi data request. Our team will review and process it according to POPIA requirements.")}
      ${detailList([
        ["Reference", reference],
        ["Target response date", dueDate],
      ])}
      ${paragraph("If we need more information to verify your identity or clarify your request, we will contact you using this email address.")}
    `,
    cta: { label: "View data request information", href: `${appUrl}/dsar`, tone: "neutral" },
    reason: "A data request was submitted to VerifyMzansi using this email address.",
  });

  const text = `Hi,\n\nWe have received your VerifyMzansi data request.\n\nReference: ${reference}\nTarget response date: ${dueDate}\n\nIf we need more information to verify your identity or clarify your request, we will contact you using this email address.\n\nLearn more: ${appUrl}/dsar`;

  return sendEmail({ to: email, subject, html, text, idempotencyKey });
}

/**
 * Written notice that an access request's deadline was extended (PAIA s57):
 * the new date and the reason.
 */
export async function sendDsarExtensionEmail(
  email: string,
  reference: string,
  newDueIso: string,
  reason: string,
  idempotencyKey?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const dueDate = new Date(newDueIso).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Johannesburg",
  });
  const subject = `VerifyMzansi data request update (${reference})`;
  const html = brandedEmail({
    tone: "neutral",
    eyebrow: "Data request",
    title: "We need more time for your request",
    intro: "This email explains a change to the response date of your data request.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("We need more time to respond to your data request, as the law allows for access requests.")}
      ${detailList([
        ["Reference", reference],
        ["New response date", dueDate],
        ["Reason", reason],
      ])}
      ${paragraph("If you do not agree with this extension, you may complain to the Information Regulator.")}
    `,
    cta: { label: "View data request information", href: `${appUrl}/dsar`, tone: "neutral" },
    reason: "A data request was submitted to VerifyMzansi using this email address.",
  });
  const text = `Hi,

We need more time to respond to your data request, as the law allows for access requests.

Reference: ${reference}
New response date: ${dueDate}
Reason: ${reason}

If you do not agree with this extension, you may complain to the Information Regulator.

Learn more: ${appUrl}/dsar`;
  return sendEmail({ to: email, subject, html, text, idempotencyKey });
}

export async function sendDsarCompletedEmail(
  email: string,
  reference: string,
  summary?: string,
  idempotencyKey?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const summaryHtml = summary ? noteBox(`<strong>Summary:</strong><br>${escapeHtml(summary)}`) : "";
  const subject = `VerifyMzansi data request completed (${reference})`;
  const html = brandedEmail({
    tone: "success",
    eyebrow: "Data request",
    title: "Data request completed",
    intro: "This email confirms your VerifyMzansi data request has been completed.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("Your VerifyMzansi data request has been marked as completed.")}
      ${detailList([["Reference", reference]])}
      ${summaryHtml}
      ${paragraph("If you still need assistance or believe something is missing, please reply to this email or contact support.")}
    `,
    cta: { label: "Data request information", href: `${appUrl}/dsar`, tone: "success" },
    reason: "A data request connected to this email address was completed by VerifyMzansi.",
  });

  const text = `Hi,\n\nYour VerifyMzansi data request has been marked as completed.\n\nReference: ${reference}${summary ? `\nSummary: ${summary}` : ""}\n\nIf you still need assistance or believe something is missing, please contact support.\n\nMore information: ${appUrl}/dsar`;

  return sendEmail({ to: email, subject, html, text, idempotencyKey });
}

export async function sendDsarRejectedEmail(
  email: string,
  reference: string,
  notes?: string,
  idempotencyKey?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const notesHtml = notes ? noteBox(`<strong>Reason:</strong><br>${escapeHtml(notes)}`) : "";
  const subject = `VerifyMzansi data request update (${reference})`;
  const html = brandedEmail({
    tone: "danger",
    eyebrow: "Data request",
    title: "Data request could not be processed",
    intro:
      "This email lets you know that your VerifyMzansi data request was reviewed and could not be processed.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("Your VerifyMzansi data request was reviewed by our team and unfortunately could not be processed.")}
      ${detailList([["Reference", reference]])}
      ${notesHtml}
      ${paragraph("If you believe this decision is incorrect, or you can provide additional information to support your request, please reply to this email or contact support.")}
    `,
    cta: { label: "Data request information", href: `${appUrl}/dsar`, tone: "danger" },
    reason: "A data request connected to this email address was reviewed by VerifyMzansi.",
  });

  const text = `Hi,\n\nYour VerifyMzansi data request was reviewed and could not be processed.\n\nReference: ${reference}${notes ? `\nReason: ${notes}` : ""}\n\nIf you believe this decision is incorrect, please contact support.\n\nMore information: ${appUrl}/dsar`;

  return sendEmail({ to: email, subject, html, text, idempotencyKey });
}

export async function sendContactFormNotification(
  email: string,
  ownerName: string,
  buyerName: string,
  buyerEmail: string,
  message: string,
  listingTitle: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = `New inquiry about "${listingTitle}"`;
  const html = brandedEmail({
    tone: "info",
    eyebrow: "Listing inquiry",
    title: "New inquiry received",
    intro: "This message came through a VerifyMzansi listing contact form.",
    bodyHtml: `
      ${paragraph(`Hi ${ownerName},`)}
      ${paragraph(`You have a new inquiry about your listing: ${listingTitle}`)}
      ${detailList([
        ["From", buyerName],
        ["Email", buyerEmail],
      ])}
      ${messageBox(message)}
      ${paragraph(`Reply directly to this email to respond to ${buyerName}.`)}
    `,
    cta: { label: "View all leads", href: `${appUrl}/dashboard/leads`, tone: "info" },
    reason: "Someone filled out the contact form on your VerifyMzansi listing.",
  });

  const text = `Hi ${ownerName},\n\nYou have a new inquiry about: ${listingTitle}\n\nFrom: ${buyerName}\nEmail: ${buyerEmail}\n\nMessage:\n${message}\n\nReply to this email to respond.\n\nView all leads: ${appUrl}/dashboard/leads`;

  return sendEmail({ to: email, subject, html, text, replyTo: buyerEmail });
}

export async function sendAccountEnforcementEmail(params: {
  email: string;
  accountName: string;
  action: "warn" | "suspend" | "ban";
  reason?: string | null;
  suspendedUntil?: string | null;
}): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const actionTitle =
    params.action === "warn"
      ? "Account warning issued"
      : params.action === "suspend"
        ? "Account suspended"
        : "Account banned";
  const subject = `VerifyMzansi account update - ${actionTitle}`;
  const statusCopy =
    params.action === "warn"
      ? "A warning has been issued on your account after a moderation review."
      : params.action === "suspend"
        ? "Your account has been temporarily suspended after a moderation review."
        : "Your account has been permanently banned after a moderation review.";
  const suspendedUntil =
    params.action === "suspend" && params.suspendedUntil
      ? new Date(params.suspendedUntil).toLocaleString("en-ZA", {
          timeZone: "Africa/Johannesburg",
        })
      : null;
  const details: Array<[string, string]> = [];
  if (params.reason) details.push(["Reason", params.reason]);
  if (suspendedUntil) details.push(["Suspension end", suspendedUntil]);

  const html = brandedEmail({
    tone: params.action === "warn" ? "warning" : "danger",
    eyebrow: "Account update",
    title: actionTitle,
    intro: "This moderation notice relates to your VerifyMzansi account.",
    bodyHtml: `
      ${paragraph(`Hi ${params.accountName},`)}
      ${paragraph(statusCopy)}
      ${details.length ? detailList(details) : ""}
      ${paragraph("If you need clarification, reply to this email and our team will assist you.")}
    `,
    cta: { label: "Review account", href: `${appUrl}/dashboard/profile#account`, tone: "danger" },
    reason: "A moderation action was recorded on your VerifyMzansi account.",
  });

  const text = `Hi ${params.accountName},\n\n${statusCopy}${params.reason ? `\n\nReason: ${params.reason}` : ""}${suspendedUntil ? `\nSuspension end: ${suspendedUntil}` : ""}\n\nReview account: ${appUrl}/dashboard/profile#account\n\nIf you need clarification, please contact support.`;

  return sendEmail({ to: params.email, subject, html, text });
}

export type ModerationNoticeTemplate =
  | "account_warn"
  | "account_suspend"
  | "account_ban"
  | "content_hidden"
  | "restriction_lifted"
  | "appeal_upheld"
  | "appeal_dismissed"
  | "appeal_overturned"
  | "appeal_partially_overturned";

const NOTICE_COPY: Record<
  ModerationNoticeTemplate,
  {
    title: string;
    body: string;
    tone: "warning" | "danger" | "success" | "info";
    appealable: boolean;
  }
> = {
  account_warn: {
    title: "Account warning issued",
    body: "A warning has been recorded on your account after a moderation review. Your account and content are not restricted.",
    tone: "warning",
    appealable: true,
  },
  account_suspend: {
    title: "Account suspended",
    body: "Your account has been suspended after a moderation review. Your listings are hidden until the suspension ends.",
    tone: "danger",
    appealable: true,
  },
  account_ban: {
    title: "Account banned",
    body: "Your account has been banned after a moderation review. Your listings are hidden.",
    tone: "danger",
    appealable: true,
  },
  content_hidden: {
    title: "Content hidden",
    body: "One of your listings has been hidden after a moderation review.",
    tone: "warning",
    appealable: true,
  },
  restriction_lifted: {
    title: "Restriction lifted",
    body: "A restriction on your account has been lifted. Content it hid has been restored where it can still be published.",
    tone: "success",
    appealable: false,
  },
  appeal_upheld: {
    title: "Your appeal was decided",
    body: "We reviewed your appeal. The original decision stands.",
    tone: "info",
    appealable: false,
  },
  appeal_dismissed: {
    title: "Your appeal was decided",
    body: "We reviewed your appeal. The original decision stands.",
    tone: "info",
    appealable: false,
  },
  appeal_overturned: {
    title: "Your appeal was successful",
    body: "We reviewed your appeal and reversed the decision. Content it hid has been restored where it can still be published.",
    tone: "success",
    appealable: false,
  },
  appeal_partially_overturned: {
    title: "Your appeal was partly successful",
    body: "We reviewed your appeal and shortened the restriction.",
    tone: "success",
    appealable: false,
  },
};

/**
 * Notice for a moderation decision or appeal outcome. It states what
 * happened, the reason and any end date, and how to appeal. It never names
 * the person who reported the content or includes staff notes.
 */
export async function sendModerationNoticeEmail(params: {
  email: string;
  accountName: string;
  template: ModerationNoticeTemplate;
  reason?: string | null;
  endsAt?: string | null;
  decisionId: string;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const copy = NOTICE_COPY[params.template];
  const endsAt = params.endsAt
    ? new Date(params.endsAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })
    : null;
  const details: Array<[string, string]> = [];
  if (params.reason) details.push([copy.appealable ? "Reason" : "Reviewer's note", params.reason]);
  if (endsAt) details.push(["Ends", endsAt]);
  const appealHref = `${appUrl}/appeals/new?decision=${encodeURIComponent(params.decisionId)}`;
  const accountHref = `${appUrl}/dashboard/profile#account`;
  const appealLine = copy.appealable
    ? "If you think this is wrong, you can ask for a review by someone who was not involved."
    : "If you have questions, reply to this email and our team will help.";

  const html = brandedEmail({
    tone: copy.tone,
    eyebrow: "Account update",
    title: copy.title,
    intro: "This notice relates to your VerifyMzansi account.",
    bodyHtml: `
      ${paragraph(`Hi ${params.accountName},`)}
      ${paragraph(copy.body)}
      ${details.length ? detailList(details) : ""}
      ${paragraph(appealLine)}
    `,
    cta: copy.appealable
      ? { label: "Ask for a review", href: appealHref, tone: "danger" }
      : { label: "Review account", href: accountHref, tone: "danger" },
    reason: "A moderation decision was recorded on your VerifyMzansi account.",
  });

  const text = [
    `Hi ${params.accountName},`,
    copy.body,
    ...details.map(([label, value]) => `${label}: ${value}`),
    appealLine,
    copy.appealable ? `Ask for a review: ${appealHref}` : `Review account: ${accountHref}`,
  ].join("\n\n");

  return sendEmail({
    to: params.email,
    subject: `VerifyMzansi account update - ${copy.title}`,
    html,
    text,
    idempotencyKey: params.idempotencyKey,
  });
}

/** A "something on your account changed" security notice. */
function sendAccountChangeNotice(
  email: string,
  change: { thing: string; title: string; changed: string; ifNotYou: string }
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = `VerifyMzansi - Your ${change.thing} was changed`;
  const html = brandedEmail({
    tone: "danger",
    eyebrow: "Security notice",
    title: change.title,
    intro: `This security notice was sent because your VerifyMzansi ${change.thing} changed.`,
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph(change.changed)}
      ${paragraph("If you made this change, no further action is needed.")}
      <p><strong>If you did not make this change</strong>, ${escapeHtml(change.ifNotYou)}</p>
    `,
    cta: { label: "Reset password", href: `${appUrl}/forgot-password`, tone: "danger" },
    reason: `Your VerifyMzansi account ${change.thing} was changed.`,
  });

  const text = `Hi,\n\n${change.changed}\n\nIf you made this change, no further action is needed.\n\nIf you did not make this change, ${change.ifNotYou} ${appUrl}/forgot-password`;

  return sendEmail({ to: email, subject, html, text });
}

export async function sendPasswordChangeNotification(email: string): Promise<SendEmailResult> {
  return sendAccountChangeNotice(email, {
    thing: "password",
    title: "Password changed",
    changed: "Your VerifyMzansi account password was just changed.",
    ifNotYou: "please reset your password immediately:",
  });
}

export async function sendSupportRequestNotification(
  category: keyof typeof CONTACT_CATEGORY_EMAILS,
  submissionId: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const label = category.replace(/_/g, " ");
  // Keep potentially sensitive reports in the authenticated support queue.
  return sendEmail({
    idempotencyKey: `support-alert/${submissionId}`,
    to: CONTACT_CATEGORY_EMAILS[category],
    subject: `New VerifyMzansi support request: ${label} (${supportReference(submissionId)})`,
    html: brandedEmail({
      title: "New support request",
      intro: `A ${label} request is ready for review.`,
      bodyHtml: paragraph(
        "Sign in to the support queue to read the request and contact the sender."
      ),
      cta: { label: "Open request", href: `${appUrl}/admin/support?submission=${submissionId}` },
      reason: "A request was saved through the VerifyMzansi contact form.",
    }),
    text: `Request ${supportReference(submissionId)}: a ${label} request is ready for review. Sign in to read it and contact the sender: ${appUrl}/admin/support?submission=${submissionId}`,
  });
}

/** One staff alert per job run listing the queued emails that failed on
 * their last attempt. Names only the notice kind and the queue entry id,
 * never the recipient or the content. */
const EOL = String.fromCharCode(10);

export async function sendOutboxFinalFailureAlert(
  items: ReadonlyArray<{ id: string; kind: string; maybeDelivered?: boolean }>
): Promise<SendEmailResult> {
  // One order for the key and the content: the same set always gives the same email.
  const lost = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = lost.map((item) => item.id);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join(",")));
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const payments = lost.filter((item) => item.kind.startsWith("payment_")).length;
  const count = `${lost.length} queued email${lost.length === 1 ? "" : "s"}`;
  const subject = `VerifyMzansi: ${count} not confirmed delivered after the last attempt${payments ? ` (${payments} payment)` : ""}`;
  const rows = lost.map((item): [string, string] => [
    `${item.kind.replace(/_/g, " ")}${item.maybeDelivered ? " (may have been delivered)" : ""}`,
    item.id,
  ]);
  const intro = `${count} could not be confirmed as delivered on the last attempt.`;
  const next =
    "These emails will not be retried automatically. Check the email provider's status and the app Worker logs for 'Queued email reached its last attempt', then contact the account owners if needed. Emails marked 'may have been delivered' were refused as a repeat of an earlier request that may have gone out.";
  return sendEmail({
    idempotencyKey: `outbox-final-failure/${key}`,
    to: SUPPORT_CONTACT_EMAIL,
    subject,
    html: brandedEmail({
      title: "Queued emails not confirmed delivered",
      intro,
      bodyHtml: `${detailList(rows)}${paragraph(next)}`,
      reason: "The VerifyMzansi job runner sends this alert to the support address.",
      tone: "warning",
    }),
    text: [intro, rows.map(([kind, id]) => `${kind}: ${id}`).join(EOL), next].join(EOL + EOL),
  });
}

export interface StaffEmailSection {
  heading?: string;
  rows: Array<[string, string]>;
}

/**
 * A staff operations email (the payment alert and the daily payment summary,
 * src/lib/foundation/payment-alerts.ts). The caller builds the content from
 * payment numbers, reason codes and counts only, never member details, and
 * picks a key that is the same for the same content, so a retry is never
 * delivered twice.
 */
export async function sendStaffOperationsEmail(params: {
  to: readonly string[];
  idempotencyKey: string;
  subject: string;
  title: string;
  intro: string;
  sections: readonly StaffEmailSection[];
  closing: string;
  reason: string;
  tone: "warning" | "info";
}): Promise<SendEmailResult> {
  const body = params.sections
    .map(
      (section) => `${section.heading ? paragraph(section.heading) : ""}${detailList(section.rows)}`
    )
    .join("");
  const text = [
    params.intro,
    ...params.sections.map((section) =>
      [section.heading, ...section.rows.map(([label, value]) => `${label}: ${value}`)]
        .filter(Boolean)
        .join(EOL)
    ),
    params.closing,
  ].join(EOL + EOL);
  return sendEmail({
    idempotencyKey: params.idempotencyKey,
    to: [...params.to],
    subject: params.subject,
    html: brandedEmail({
      title: params.title,
      intro: params.intro,
      bodyHtml: `${body}${paragraph(params.closing)}`,
      reason: params.reason,
      tone: params.tone,
    }),
    text,
  });
}

export async function sendSupportAcknowledgement(
  email: string,
  submissionId: string,
  category: keyof typeof CONTACT_CATEGORY_EMAILS
): Promise<SendEmailResult> {
  const reference = supportReference(submissionId);
  // Never echo unverified form content into mail sent to an arbitrary address.
  return sendEmail({
    to: email,
    replyTo: CONTACT_CATEGORY_EMAILS[category],
    idempotencyKey: `support-ack/${submissionId}`,
    subject: `VerifyMzansi request received (${reference})`,
    html: brandedEmail({
      title: "Request received",
      intro: "Your request has been saved in our support inbox for review.",
      bodyHtml: `${detailList([["Reference", reference]])}${paragraph("Our team will reply after reviewing your request. Keep this reference when contacting us. If you did not submit a request, you can ignore this message.")}`,
      reason: "A request was submitted using this email address on VerifyMzansi.",
    }),
    text: `Your request has been saved in our support inbox for review.\n\nReference: ${reference}\n\nOur team will reply after reviewing your request. Keep this reference when contacting us. If you did not submit a request, you can ignore this message.`,
  });
}

function formatSast(iso: string): string {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  });
}

/**
 * Invitation to administer a sponsor programme. The link is single use, bound
 * to this address and valid for 7 days; opening it never accepts on its own.
 */
export async function sendOrganisationAdminInviteEmail(params: {
  email: string;
  organisationName: string;
  acceptUrl: string;
  expiresAt: string;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  const expires = formatSast(params.expiresAt);
  const subject = `You're invited to manage ${params.organisationName} on VerifyMzansi`;
  const html = brandedEmail({
    tone: "info",
    eyebrow: "Programme administrator",
    title: `Manage ${params.organisationName} on VerifyMzansi`,
    intro: "VerifyMzansi has invited you to administer a Business Sponsor account.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph(`As an administrator of ${params.organisationName} you can approve which businesses join the programme, manage supported places and download activity reports. You will not see identity documents, selfies or private messages.`)}
      ${detailList([
        ["Programme", params.organisationName],
        ["Invitation sent to", params.email],
        ["Link expires", `${expires} SAST`],
      ])}
      ${paragraph("Sign in or register with this email address. If your identity has not been reviewed yet, you will be asked to complete that first.")}
    `,
    cta: { label: "Review invitation", href: params.acceptUrl },
    reason: "A VerifyMzansi administrator invited this email address to manage a programme.",
  });
  const text = [
    "Hi,",
    `VerifyMzansi has invited you to administer ${params.organisationName}. You can approve which businesses join, manage supported places and download activity reports. You will not see identity documents, selfies or private messages.`,
    `Review the invitation (expires ${expires} SAST): ${params.acceptUrl}`,
    "Sign in or register with this email address. If you did not expect this, ignore this email.",
  ].join("\n\n");
  return sendEmail({
    to: params.email,
    subject,
    html,
    text,
    idempotencyKey: params.idempotencyKey,
  });
}

/** One-time code proving a company representative controls a work mailbox. */
export async function sendWorkEmailCode(params: {
  email: string;
  businessName: string;
  code: string;
}): Promise<SendEmailResult> {
  const html = brandedEmail({
    tone: "success",
    eyebrow: "Business verification",
    title: "Your work email code",
    intro: "Use this code to confirm you represent the company on VerifyMzansi.",
    bodyHtml: `
      ${detailList([
        ["Business", params.businessName],
        ["Code", params.code],
      ])}
      ${paragraph("The code expires in 15 minutes. If you didn't ask for it, you can ignore this email.")}
    `,
    reason: "Someone asked to confirm this work email for a business verification on VerifyMzansi.",
  });
  const text = `Your VerifyMzansi code for ${params.businessName} is ${params.code}. It expires in 15 minutes. If you didn't ask for it, ignore this email.`;
  return sendEmail({
    to: params.email,
    subject: `${params.code} is your VerifyMzansi code`,
    html,
    text,
  });
}
