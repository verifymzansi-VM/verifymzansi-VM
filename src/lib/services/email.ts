import { Resend } from "resend";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("Email");

/**
 * Resend email service for VerifyMzansi transactional emails
 */

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
const REPLY_TO = "support@verifymzansi.com";

/**
 * Sanitize the app URL to prevent XSS via javascript: protocol injection.
 * Only allows URLs starting with https:// (or http://localhost for dev).
 */
function sanitizeAppUrl(url: string | undefined): string {
  const raw = url || "";
  if (raw.startsWith("https://")) return raw;
  if (raw.startsWith("http://localhost")) return raw;
  return "https://verifymzansi.com";
}

/**
 * Escape user-supplied text before inserting into HTML email templates.
 * Prevents XSS if emails are rendered in webmail clients.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

/** Maximum number of retry attempts for transient Resend failures. */
const EMAIL_MAX_RETRIES = 2;
/** Base delay in ms for exponential back-off between retries. */
const EMAIL_BASE_DELAY_MS = 1_000;
/** Timeout for each Resend API call. */
const EMAIL_TIMEOUT_MS = 10_000;

function isRetryableEmailError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof TypeError) return true; // network failure
  return false;
}

function isRetryableStatusMessage(message: string | undefined): boolean {
  if (!message) return false;
  return /rate.?limit|429|5\d{2}/i.test(message);
}

/**
 * Send a generic email via Resend with retry + timeout.
 */
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

/**
 * Send verification approved email
 */
export async function sendVerificationApprovedEmail(
  email: string,
  accountName: string
): Promise<SendEmailResult> {
  const subject = "🎉 Your VerifyMzansi Account is Verified!";
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">✅ Verification Approved</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(accountName)},</p>
            <p>Great news! Your VerifyMzansi account has been successfully verified.</p>
            <p>You can now:</p>
            <ul>
              <li>Create and publish listings in Mzansi Market</li>
              <li>Set up your Business Ad profile</li>
              <li>Register your Mall Shop</li>
              <li>Start connecting with verified buyers</li>
            </ul>
            <p style="text-align: center;">
              <a href="${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard" class="button">Go to Dashboard</a>
            </p>
            <p>Thank you for choosing VerifyMzansi - South Africa's trusted verification marketplace.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${accountName},\n\nGreat news! Your VerifyMzansi account has been successfully verified.\n\nYou can now create listings, set up profiles, and connect with buyers.\n\nVisit your dashboard: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard\n\nThank you for choosing VerifyMzansi.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send verification rejected email
 */
export async function sendVerificationRejectedEmail(
  email: string,
  accountName: string,
  reason: string
): Promise<SendEmailResult> {
  const subject = "VerifyMzansi Verification Update";
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Verification Review Required</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(accountName)},</p>
            <p>We've reviewed your verification submission, and unfortunately we need you to resubmit some information.</p>
            <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
            <p>Please review the requirements and submit again:</p>
            <p style="text-align: center;">
              <a href="${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/verification" class="button">Resubmit Verification</a>
            </p>
            <p>If you have questions, please contact our support team.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${accountName},\n\nWe've reviewed your verification submission and need you to resubmit some information.\n\nReason: ${reason}\n\nPlease resubmit at: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/verification\n\nContact us if you have questions.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send verification resubmission email
 */
export async function sendVerificationResubmissionEmail(
  email: string,
  accountName: string,
  reason: string
): Promise<SendEmailResult> {
  const subject = "VerifyMzansi verification resubmission required";
  const safeReason = escapeHtml(reason);
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f59e0b; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Verification resubmission needed</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(accountName)},</p>
            <p>We reviewed your verification submission and need updated information before we can continue.</p>
            <p><strong>What to fix:</strong> ${safeReason}</p>
            <p style="text-align: center;">
              <a href="${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/verification" class="button">Update verification</a>
            </p>
            <p>If you need help, reply to this email and our support team will assist you.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${accountName},\n\nWe reviewed your verification submission and need updated information.\n\nWhat to fix: ${reason}\n\nUpdate verification: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/verification\n\nIf you need help, reply to this email.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send payment receipt email
 */
export async function sendPaymentReceiptEmail(
  email: string,
  accountName: string,
  amount: number,
  planName: string,
  invoiceUrl?: string
): Promise<SendEmailResult> {
  const subject = `Payment Receipt - ${planName}`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .receipt { background: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .total { font-size: 1.25em; font-weight: bold; color: #10b981; }
          .button { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">✅ Payment Received</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(accountName)},</p>
            <p>Thank you for your payment. Your subscription is now active!</p>
            <div class="receipt">
              <div class="row">
                <span>Plan:</span>
                <span><strong>${escapeHtml(planName)}</strong></span>
              </div>
              <div class="row">
                <span>Amount:</span>
                <span class="total">R ${amount.toFixed(2)}</span>
              </div>
              <div class="row" style="border-bottom: none;">
                <span>Status:</span>
                <span style="color: #10b981;"><strong>✓ Active</strong></span>
              </div>
            </div>
            ${
              invoiceUrl &&
              (() => {
                try {
                  const u = new URL(invoiceUrl);
                  return u.protocol === "https:" || u.protocol === "http:";
                } catch {
                  return false;
                }
              })()
                ? `<p style="text-align: center;"><a href="${escapeHtml(invoiceUrl)}" class="button">Download Invoice</a></p>`
                : ""
            }
            <p>Your subscription will renew automatically in 30 days.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${accountName},\n\nThank you for your payment!\n\nPlan: ${planName}\nAmount: R ${amount.toFixed(2)}\nStatus: Active\n\nYour subscription will renew automatically in 30 days.\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send payment failed email with retry instructions.
 */
export async function sendPaymentFailedEmail(
  email: string,
  accountName: string,
  amount: number,
  planName: string
): Promise<SendEmailResult> {
  const subject = `Payment failed - ${planName}`;
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .summary { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Payment could not be completed</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(accountName)},</p>
            <p>We could not process your payment. Your plan has not been activated yet.</p>
            <div class="summary">
              <p style="margin: 0 0 8px;"><strong>Plan:</strong> ${escapeHtml(planName)}</p>
              <p style="margin: 0;"><strong>Amount:</strong> R ${amount.toFixed(2)}</p>
            </div>
            <p style="text-align: center;">
              <a href="${appUrl}/billing" class="button">Retry payment</a>
            </p>
            <p>If you believe this is an error, contact support and include your account email.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${accountName},\n\nWe could not process your payment for ${planName}.\nAmount: R ${amount.toFixed(2)}\n\nRetry payment: ${appUrl}/billing\n\nIf you believe this is an error, please contact support.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send a DSAR submission confirmation email.
 */
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
  const safeReference = escapeHtml(reference);
  const safeDueDate = escapeHtml(dueDate);
  const subject = `VerifyMzansi data request received (${reference})`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #111827; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .meta { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Data Request Received</h1>
          </div>
          <div class="content">
            <p>Hi,</p>
            <p>We have received your VerifyMzansi data request. Our team will review and process it according to POPIA requirements.</p>
            <div class="meta">
              <p style="margin: 0 0 8px;"><strong>Reference:</strong> ${safeReference}</p>
              <p style="margin: 0;"><strong>Target response date:</strong> ${safeDueDate}</p>
            </div>
            <p>If we need more information to verify your identity or clarify your request, we will contact you using this email address.</p>
            <p style="text-align: center;">
              <a href="${appUrl}/dsar" class="button">View Data Request Information</a>
            </p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi,\n\nWe have received your VerifyMzansi data request.\n\nReference: ${reference}\nTarget response date: ${dueDate}\n\nIf we need more information to verify your identity or clarify your request, we will contact you using this email address.\n\nLearn more: ${appUrl}/dsar\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send a DSAR completion notification email.
 */
export async function sendDsarCompletedEmail(
  email: string,
  reference: string,
  summary?: string
): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const safeReference = escapeHtml(reference);
  const safeSummary = summary ? escapeHtml(summary) : null;
  const subject = `VerifyMzansi data request completed (${reference})`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #10b981; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .summary { background: #f9fafb; padding: 16px; border-radius: 8px; margin: 20px 0; }
          .button { display: inline-block; background: #111827; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Data Request Completed</h1>
          </div>
          <div class="content">
            <p>Hi,</p>
            <p>Your VerifyMzansi data request has been marked as completed.</p>
            <p><strong>Reference:</strong> ${safeReference}</p>
            ${safeSummary ? `<div class="summary"><strong>Summary:</strong><br>${safeSummary}</div>` : ""}
            <p>If you still need assistance or believe something is missing, please reply to this email or contact support.</p>
            <p style="text-align: center;">
              <a href="${appUrl}/dsar" class="button">Data Request Information</a>
            </p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi,\n\nYour VerifyMzansi data request has been marked as completed.\n\nReference: ${reference}${summary ? `\nSummary: ${summary}` : ""}\n\nIf you still need assistance or believe something is missing, please contact support.\n\nMore information: ${appUrl}/dsar\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send a notification to an existing user when someone tries to register
 * with their email. This avoids email enumeration while giving the real
 * owner an actionable path (sign in or reset password).
 */
export async function sendAlreadyRegisteredEmail(email: string): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi — Sign-in attempt with your email";
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .button-secondary { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Account Already Exists</h1>
          </div>
          <div class="content">
            <p>Hi,</p>
            <p>Someone (hopefully you) tried to create a new VerifyMzansi account with this email address, but you already have an account.</p>
            <p>If this was you, you can sign in or reset your password:</p>
            <p style="text-align: center;">
              <a href="${appUrl}/login" class="button">Sign in</a>
              &nbsp;&nbsp;
              <a href="${appUrl}/forgot-password" class="button-secondary">Reset Password</a>
            </p>
            <p>If you didn't attempt to register, you can safely ignore this email. Your account is secure.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi,\n\nSomeone tried to create a new VerifyMzansi account with this email address, but you already have an account.\n\nSign in: ${appUrl}/login\nReset password: ${appUrl}/forgot-password\n\nIf you didn't attempt to register, you can safely ignore this email.\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send contact form submission notification to the listing owner
 */
export async function sendContactFormNotification(
  email: string,
  ownerName: string,
  buyerName: string,
  buyerEmail: string,
  message: string,
  listingTitle: string
): Promise<SendEmailResult> {
  const subject = `New inquiry about "${listingTitle}"`;
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #3b82f6; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .message-box { background: #f9fafb; padding: 20px; border-left: 4px solid #3b82f6; margin: 20px 0; }
          .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">📬 New Inquiry</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(ownerName)},</p>
            <p>You have a new inquiry about your listing: <strong>${escapeHtml(listingTitle)}</strong></p>
            <p><strong>From:</strong> ${escapeHtml(buyerName)}<br>
            <strong>Email:</strong> ${escapeHtml(buyerEmail)}</p>
            <div class="message-box">
              <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
            </div>
            <p>Reply directly to this email to respond to ${escapeHtml(buyerName)}.</p>
            <p style="text-align: center;">
              <a href="${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard/leads" class="button">View All Leads</a>
            </p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>This email was sent because someone filled out the contact form on your listing.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${ownerName},\n\nYou have a new inquiry about: ${listingTitle}\n\nFrom: ${buyerName}\nEmail: ${buyerEmail}\n\nMessage:\n${message}\n\nReply to this email to respond.\n\nView all leads: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard/leads`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send account enforcement action email.
 */
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

  const suspensionCopy =
    params.action === "suspend" && params.suspendedUntil
      ? `<p><strong>Suspension end:</strong> ${escapeHtml(new Date(params.suspendedUntil).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }))}</p>`
      : "";

  const reasonCopy = params.reason
    ? `<p><strong>Reason:</strong> ${escapeHtml(params.reason)}</p>`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #111827; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">${actionTitle}</h1>
          </div>
          <div class="content">
            <p>Hi ${escapeHtml(params.accountName)},</p>
            <p>${statusCopy}</p>
            ${reasonCopy}
            ${suspensionCopy}
            <p style="text-align: center;">
              <a href="${appUrl}/dashboard/profile#account" class="button">Review account</a>
            </p>
            <p>If you need clarification, reply to this email and our team will assist you.</p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${params.accountName},\n\n${statusCopy}${params.reason ? `\n\nReason: ${params.reason}` : ""}${params.action === "suspend" && params.suspendedUntil ? `\nSuspension end: ${new Date(params.suspendedUntil).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}` : ""}\n\nReview account: ${appUrl}/dashboard/profile#account\n\nIf you need clarification, please contact support.`;

  return sendEmail({ to: params.email, subject, html, text });
}

/**
 * Notify user that their password was changed successfully.
 * Allows them to take action if the change was not initiated by them.
 */
export async function sendPasswordChangeNotification(email: string): Promise<SendEmailResult> {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const subject = "VerifyMzansi — Your password was changed";
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; }
          .button { display: inline-block; background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">Password Changed</h1>
          </div>
          <div class="content">
            <p>Hi,</p>
            <p>Your VerifyMzansi account password was just changed.</p>
            <p>If you made this change, no further action is needed.</p>
            <p><strong>If you did not change your password</strong>, please reset it immediately:</p>
            <p style="text-align: center;">
              <a href="${appUrl}/forgot-password" class="button">Reset Password</a>
            </p>
            <p>Best regards,<br>The VerifyMzansi Team</p>
          </div>
          <div class="footer">
            <p>Questions? Email us at support@verifymzansi.com</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi,\n\nYour VerifyMzansi account password was just changed.\n\nIf you made this change, no further action is needed.\n\nIf you did not change your password, reset it immediately: ${appUrl}/forgot-password\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}
