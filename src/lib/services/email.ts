import { Resend } from "resend";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";
import { createLogger } from "@/lib/utils/logger";
import {
  brandedEmail,
  detailList,
  escapeHtml,
  isSafeHttpUrl,
  paragraph,
  sanitizeAppUrl,
} from "@/lib/services/email-template";

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
const REPLY_TO = process.env.VERIFYMZANSI_SUPPORT_EMAIL?.trim() || SUPPORT_CONTACT_EMAIL;

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const EMAIL_MAX_RETRIES = 2;
const EMAIL_BASE_DELAY_MS = 1_000;
const EMAIL_TIMEOUT_MS = 10_000;

function isRetryableEmailError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return false;
}

function isRetryableStatusMessage(message: string | undefined): boolean {
  if (!message) return false;
  return /rate.?limit|429|5\d{2}/i.test(message);
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

  for (let attempt = 0; attempt <= EMAIL_MAX_RETRIES; attempt++) {
    try {
      const sendPromise = getResend().emails.send({
        from: FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: REPLY_TO,
      });
      const result = await Promise.race([
        sendPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Email send timed out")), EMAIL_TIMEOUT_MS)
        ),
      ]);

      if (result.error) {
        lastError = result.error.message;
        if (isRetryableStatusMessage(result.error.message) && attempt < EMAIL_MAX_RETRIES) {
          const backoff = EMAIL_BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn("Resend transient error, retrying", {
            attempt: attempt + 1,
            error: result.error.message,
            nextDelayMs: backoff,
          });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        log.error("Resend error", { error: result.error });
        return { success: false, error: result.error.message };
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
  const subject = "Your VerifyMzansi Account is Verified";
  const html = brandedEmail({
    tone: "success",
    eyebrow: "Verification complete",
    title: "Your account is verified",
    intro: "This email confirms your VerifyMzansi account review is complete.",
    bodyHtml: `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph("Great news. Your VerifyMzansi account has been successfully verified.")}
      <p>You can now:</p>
      <ul>
        <li>Create and publish listings in Mzansi Market</li>
        <li>Set up a business profile as its accountable representative</li>
        <li>Add shop, service, or mall-store details where relevant</li>
        <li>Start connecting with identity-reviewed members</li>
      </ul>
      ${paragraph("Thank you for choosing VerifyMzansi.")}
    `,
    cta: { label: "Go to dashboard", href: `${appUrl}/dashboard`, tone: "success" },
    reason: "Your account verification status changed on VerifyMzansi.",
  });

  const text = `Hi ${accountName},\n\nGreat news. Your VerifyMzansi account has been successfully verified.\n\nYou can now create listings, set up profiles, and connect with identity-reviewed members.\n\nGo to dashboard: ${appUrl}/dashboard\n\nThis email was sent because your account verification status changed on VerifyMzansi.\n\nThank you for choosing VerifyMzansi.`;

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
      ? `Your subscription is active until ${expiryDate}.`
      : "Your subscription is active for 30 days from the payment date.";
    bodyHtml = `
      ${paragraph(`Hi ${accountName},`)}
      ${paragraph(`Thank you for your payment. ${activeUntilLine}`)}
      ${detailList([
        ["Plan", planName],
        ["Amount", `R ${amount.toFixed(2)}`],
        ["Status", "Active"],
        ...(expiryDate ? ([["Active until", expiryDate]] as [string, string][]) : []),
      ])}
      ${paragraph("Plans do not auto-renew. You can renew from your billing page when your plan ends.")}
    `;
    textBody = `Hi ${accountName},\n\nThank you for your payment. ${activeUntilLine}\n\nPlan: ${planName}\nAmount: R ${amount.toFixed(2)}\nStatus: Active${expiryDate ? `\nActive until: ${expiryDate}` : ""}${safeInvoiceUrl ? `\nInvoice: ${safeInvoiceUrl}` : ""}\n\nPlans do not auto-renew. You can renew from your billing page when your plan ends.\n\nThis receipt was sent because a payment was processed for your VerifyMzansi account.`;
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
  dueByIso: string
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

  return sendEmail({ to: email, subject, html, text });
}

export async function sendDsarCompletedEmail(
  email: string,
  reference: string,
  summary?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const summaryHtml = summary
    ? `<div class="details"><strong>Summary:</strong><br>${escapeHtml(summary)}</div>`
    : "";
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

  return sendEmail({ to: email, subject, html, text });
}

export async function sendDsarRejectedEmail(
  email: string,
  reference: string,
  notes?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const notesHtml = notes
    ? `<div class="details"><strong>Reason:</strong><br>${escapeHtml(notes)}</div>`
    : "";
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

  return sendEmail({ to: email, subject, html, text });
}

export async function sendAlreadyRegisteredEmail(email: string): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi - Sign-in attempt with your email";
  const html = brandedEmail({
    tone: "info",
    eyebrow: "Account notice",
    title: "Account already exists",
    intro: "This security notice was sent because this email address was used on VerifyMzansi.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("Someone tried to create a new VerifyMzansi account with this email address, but you already have an account.")}
      ${paragraph("If this was you, sign in or reset your password. If it was not you, you can safely ignore this email.")}
    `,
    cta: { label: "Sign in", href: `${appUrl}/login`, tone: "success" },
    secondaryCta: { label: "Reset password", href: `${appUrl}/forgot-password`, tone: "info" },
    reason:
      "A registration attempt used an email address that already belongs to a VerifyMzansi account.",
  });

  const text = `Hi,\n\nSomeone tried to create a new VerifyMzansi account with this email address, but you already have an account.\n\nSign in: ${appUrl}/login\nReset password: ${appUrl}/forgot-password\n\nIf you did not attempt to register, you can safely ignore this email.`;

  return sendEmail({ to: email, subject, html, text });
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
      <div class="message-box">${escapeHtml(message)}</div>
      ${paragraph(`Reply directly to this email to respond to ${buyerName}.`)}
    `,
    cta: { label: "View all leads", href: `${appUrl}/dashboard/leads`, tone: "info" },
    reason: "Someone filled out the contact form on your VerifyMzansi listing.",
  });

  const text = `Hi ${ownerName},\n\nYou have a new inquiry about: ${listingTitle}\n\nFrom: ${buyerName}\nEmail: ${buyerEmail}\n\nMessage:\n${message}\n\nReply to this email to respond.\n\nView all leads: ${appUrl}/dashboard/leads`;

  return sendEmail({ to: email, subject, html, text });
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

export async function sendPasswordChangeNotification(email: string): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi - Your password was changed";
  const html = brandedEmail({
    tone: "danger",
    eyebrow: "Security notice",
    title: "Password changed",
    intro: "This security notice was sent because your VerifyMzansi password changed.",
    bodyHtml: `
      ${paragraph("Hi,")}
      ${paragraph("Your VerifyMzansi account password was just changed.")}
      ${paragraph("If you made this change, no further action is needed.")}
      <p><strong>If you did not change your password</strong>, please reset it immediately.</p>
    `,
    cta: { label: "Reset password", href: `${appUrl}/forgot-password`, tone: "danger" },
    reason: "Your VerifyMzansi account password was changed.",
  });

  const text = `Hi,\n\nYour VerifyMzansi account password was just changed.\n\nIf you made this change, no further action is needed.\n\nIf you did not change your password, reset it immediately: ${appUrl}/forgot-password`;

  return sendEmail({ to: email, subject, html, text });
}
