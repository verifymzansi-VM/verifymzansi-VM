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

const FROM_EMAIL = "VerifyMzansi <noreply@verifymzansi.co.za>";
const REPLY_TO = "support@verifymzansi.co.za";

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

/**
 * Send a generic email via Resend
 */
async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (process.env.NODE_ENV === "development") {
    log.warn("Mock email sending", { subject: params.subject });
    return {
      success: true,
      messageId: "mock-" + Date.now(),
    };
  }

  try {
    const result = await getResend().emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      replyTo: REPLY_TO,
    });

    if (result.error) {
      log.error("Resend error", { error: result.error });
      return {
        success: false,
        error: result.error.message,
      };
    }

    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error) {
    log.error("Send error", { error: error instanceof Error ? error.message : "unknown error" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Email sending failed",
    };
  }
}

/**
 * Send verification approved email
 */
export async function sendVerificationApprovedEmail(
  email: string,
  sellerName: string
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
            <p>Hi ${escapeHtml(sellerName)},</p>
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
            <p>Questions? Email us at support@verifymzansi.co.za</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${sellerName},\n\nGreat news! Your VerifyMzansi account has been successfully verified.\n\nYou can now create listings, set up profiles, and connect with buyers.\n\nVisit your dashboard: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard\n\nThank you for choosing VerifyMzansi.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send verification rejected email
 */
export async function sendVerificationRejectedEmail(
  email: string,
  sellerName: string,
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
            <p>Hi ${escapeHtml(sellerName)},</p>
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
            <p>Questions? Email us at support@verifymzansi.co.za</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${sellerName},\n\nWe've reviewed your verification submission and need you to resubmit some information.\n\nReason: ${reason}\n\nPlease resubmit at: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/verification\n\nContact us if you have questions.`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send payment receipt email
 */
export async function sendPaymentReceiptEmail(
  email: string,
  sellerName: string,
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
            <p>Hi ${escapeHtml(sellerName)},</p>
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
            <p>Questions? Email us at support@verifymzansi.co.za</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const text = `Hi ${sellerName},\n\nThank you for your payment!\n\nPlan: ${planName}\nAmount: R ${amount.toFixed(2)}\nStatus: Active\n\nYour subscription will renew automatically in 30 days.\n\nBest regards,\nThe VerifyMzansi Team`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send contact form submission notification to seller
 */
export async function sendContactFormNotification(
  email: string,
  sellerName: string,
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
            <p>Hi ${escapeHtml(sellerName)},</p>
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

  const text = `Hi ${sellerName},\n\nYou have a new inquiry about: ${listingTitle}\n\nFrom: ${buyerName}\nEmail: ${buyerEmail}\n\nMessage:\n${message}\n\nReply to this email to respond.\n\nView all leads: ${sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL)}/dashboard/leads`;

  return sendEmail({ to: email, subject, html, text });
}
