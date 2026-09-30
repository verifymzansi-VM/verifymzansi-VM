export type EmailTone = "success" | "info" | "warning" | "danger" | "neutral";

import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";

interface EmailCta {
  label: string;
  href: string;
  tone?: EmailTone;
}

interface BrandedEmailParams {
  title: string;
  eyebrow?: string;
  intro: string;
  bodyHtml: string;
  cta?: EmailCta;
  secondaryCta?: EmailCta;
  reason?: string;
  footerNote?: string;
  tone?: EmailTone;
  preheader?: string;
}

const BRAND_NAME = "VerifyMzansi";
const SUPPORT_EMAIL = SUPPORT_CONTACT_EMAIL;
const DEFAULT_APP_URL = "https://verifymzansi.com";

/**
 * Brand palette, mirrored from tailwind.config.ts. Email clients cannot read
 * CSS variables, so the hex values live here.
 */
export const EMAIL_COLORS = {
  green950: "#03241d",
  green900: "#073f32",
  green700: "#08624a",
  green600: "#0b7a55",
  green300: "#72d2ab",
  green50: "#edfaf4",
  gold400: "#f9a826",
  gold300: "#ffc24d",
  gold950: "#411904",
  red600: "#d63b22",
  blue700: "#2c3fb8",
  page: "#efece4",
  ink: "#16211d",
  body: "#3b4744",
  muted: "#6b7672",
  line: "#e6e2d8",
  soft: "#f7f5f0",
} as const;

// Single quotes only: this is interpolated into style="..." attributes.
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** Eyebrow colour on the dark header and button colours, per tone. */
const toneStyles: Record<EmailTone, { eyebrow: string; button: string; buttonText: string }> = {
  success: { eyebrow: EMAIL_COLORS.green300, button: EMAIL_COLORS.green600, buttonText: "#ffffff" },
  info: { eyebrow: EMAIL_COLORS.gold300, button: EMAIL_COLORS.green600, buttonText: "#ffffff" },
  warning: {
    eyebrow: EMAIL_COLORS.gold300,
    button: EMAIL_COLORS.gold400,
    buttonText: EMAIL_COLORS.gold950,
  },
  danger: { eyebrow: "#ffa99a", button: EMAIL_COLORS.red600, buttonText: "#ffffff" },
  neutral: { eyebrow: EMAIL_COLORS.gold300, button: EMAIL_COLORS.green950, buttonText: "#ffffff" },
};

export function sanitizeAppUrl(url: string | undefined): string {
  const raw = url || "";
  if (raw.startsWith("https://")) return raw.replace(/\/+$/, "");
  if (raw.startsWith("http://localhost")) return raw.replace(/\/+$/, "");
  return DEFAULT_APP_URL;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isSafeHttpUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;
}

/** Label/value rows in a soft card. Values are escaped. */
export function detailList(items: Array<[string, string]>): string {
  const rows = items
    .map(
      ([label, value], index) => `
        <tr>
          <td class="vm-detail-label" style="padding:11px 0;${index ? `border-top:1px solid ${EMAIL_COLORS.line};` : ""}color:${EMAIL_COLORS.muted};font-size:14px;vertical-align:top;width:42%;">${escapeHtml(label)}</td>
          <td class="vm-detail-value" style="padding:11px 0;${index ? `border-top:1px solid ${EMAIL_COLORS.line};` : ""}color:${EMAIL_COLORS.ink};font-size:14px;font-weight:700;text-align:right;vertical-align:top;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:separate;background:${EMAIL_COLORS.soft};border:1px solid ${EMAIL_COLORS.line};border-radius:14px;">
      <tr><td style="padding:6px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
      </td></tr>
    </table>`;
}

/** Soft card for trusted HTML (callers escape user text themselves). */
export function noteBox(html: string): string {
  return `<div style="margin:20px 0;padding:16px 18px;background:${EMAIL_COLORS.soft};border:1px solid ${EMAIL_COLORS.line};border-radius:14px;color:${EMAIL_COLORS.body};">${html}</div>`;
}

/** Quoted user message, e.g. a contact form enquiry. Text is escaped. */
export function messageBox(text: string): string {
  return `<div style="margin:20px 0;padding:16px 18px;background:${EMAIL_COLORS.green50};border-left:4px solid ${EMAIL_COLORS.green600};border-radius:0 14px 14px 0;color:${EMAIL_COLORS.ink};white-space:pre-wrap;">${escapeHtml(text)}</div>`;
}

/** Six-colour flag rule; widths follow the site's SaFlagStripe proportions. */
function flagStripe(): string {
  const bands: Array<[string, number]> = [
    [EMAIL_COLORS.green600, 27],
    [EMAIL_COLORS.gold400, 9],
    ["#ffffff", 9],
    [EMAIL_COLORS.red600, 19],
    ["#ffffff", 9],
    [EMAIL_COLORS.blue700, 18],
    ["#000000", 9],
  ];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${bands
    .map(
      ([color, width]) =>
        `<td width="${width}%" height="6" style="height:6px;line-height:6px;font-size:0;background:${color};">&nbsp;</td>`
    )
    .join("")}</tr></table>`;
}

/** Bulletproof (table-based) button that renders in Outlook too. */
function button(cta: EmailCta, variant: "primary" | "secondary", fallbackTone: EmailTone): string {
  const tone = toneStyles[cta.tone ?? fallbackTone];
  const bg = variant === "primary" ? tone.button : "#ffffff";
  const color = variant === "primary" ? tone.buttonText : EMAIL_COLORS.green700;
  const border = variant === "primary" ? tone.button : "#cfd8d3";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;margin:6px 4px 0;border-collapse:separate;">
      <tr><td style="border-radius:999px;background:${bg};border:1px solid ${border};">
        <a href="${escapeHtml(cta.href)}" class="vm-button" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:${color};text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
      </td></tr>
    </table>`;
}

/**
 * Shared layout for every platform email: deep-green header with the shield
 * lockup and headline, flag stripe, white body card, security note, and a
 * green footer. Table-based with inline styles for Gmail/Outlook.
 */
export function brandedEmail(params: BrandedEmailParams): string {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const toneKey = params.tone ?? "info";
  const tone = toneStyles[toneKey];
  const shieldUrl = `${appUrl}/images/brand-shield-small.png`;
  const safeTitle = escapeHtml(params.title);
  const safeEyebrow = params.eyebrow ? escapeHtml(params.eyebrow) : BRAND_NAME;
  const safeIntro = escapeHtml(params.intro);
  const safePreheader = escapeHtml(params.preheader ?? params.intro);
  const footerNote =
    params.footerNote ??
    "This email was sent by VerifyMzansi. We will never ask for your password or payment card details by email.";
  const C = EMAIL_COLORS;

  const ctaBlock =
    params.cta || params.secondaryCta
      ? `
        <tr><td class="vm-pad" align="center" style="padding:4px 40px 8px;">
          ${params.cta ? button(params.cta, "primary", toneKey) : ""}${params.secondaryCta ? button(params.secondaryCta, "secondary", toneKey) : ""}
          ${
            params.cta
              ? `<p style="margin:18px 0 0;color:${C.muted};font-size:12px;line-height:1.6;word-break:break-word;">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(params.cta.href)}" style="color:${C.green700};">${escapeHtml(params.cta.href)}</a></p>`
              : ""
          }
        </td></tr>`
      : "";

  const reasonBlock = params.reason
    ? `
        <tr><td class="vm-pad" style="padding:20px 40px 0;">
          <p style="margin:0;padding:14px 16px;background:${C.soft};border-radius:12px;color:${C.body};font-size:13px;line-height:1.6;"><strong style="color:${C.ink};">Why you received this:</strong> ${escapeHtml(params.reason)}</p>
        </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
      a { color: ${C.green700}; }
      .vm-content p { margin: 0 0 16px; }
      .vm-content ul, .vm-content ol { margin: 0 0 18px 20px; padding: 0; }
      .vm-content li { margin: 0 0 8px; }
      @media (max-width: 620px) {
        .vm-outer { padding: 0 !important; }
        .vm-card { border-radius: 0 !important; }
        .vm-pad { padding-left: 22px !important; padding-right: 22px !important; }
        .vm-title { font-size: 25px !important; }
        .vm-detail-label, .vm-detail-value { display: block !important; width: 100% !important; text-align: left !important; }
        .vm-detail-value { padding-top: 0 !important; border-top: 0 !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${C.page};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};border-collapse:collapse;">
      <tr><td class="vm-outer" align="center" style="padding:32px 12px;">
        <table role="presentation" class="vm-card" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:separate;background:#ffffff;border-radius:20px;overflow:hidden;font-family:${FONT};color:${C.body};font-size:16px;line-height:1.65;box-shadow:0 18px 40px rgba(3,36,29,0.12);">

          <!-- Header -->
          <tr><td class="vm-pad" style="padding:28px 40px 34px;background:${C.green950};background-image:radial-gradient(ellipse at top left, rgba(20,154,107,0.35), transparent 60%);">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="${escapeHtml(shieldUrl)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border:0;">
                </td>
                <td style="vertical-align:middle;">
                  <p style="margin:0;color:rgba(255,255,255,0.7);font-size:9px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;line-height:1.2;">Trusted marketplace</p>
                  <p style="margin:3px 0 0;font-size:22px;font-weight:800;letter-spacing:-0.4px;line-height:1.1;"><span style="color:#ffffff;">Verify</span> <span style="color:${C.green300};">Mzansi</span></p>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0;"><span style="display:inline-block;padding:5px 12px;border:1px solid rgba(255,255,255,0.14);border-radius:999px;background:${C.green900};color:${tone.eyebrow};font-size:12px;font-weight:700;letter-spacing:0.3px;">${safeEyebrow}</span></p>
            <h1 class="vm-title" style="margin:14px 0 0;color:#ffffff;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.6px;">${safeTitle}</h1>
            <p style="margin:12px 0 0;color:rgba(255,255,255,0.78);font-size:16px;line-height:1.6;">${safeIntro}</p>
          </td></tr>
          <tr><td style="padding:0;">${flagStripe()}</td></tr>

          <!-- Body -->
          <tr><td class="vm-pad vm-content" style="padding:32px 40px 12px;color:${C.body};font-size:16px;line-height:1.65;">
            ${params.bodyHtml}
            <p style="margin:0 0 16px;">Best regards,<br><strong style="color:${C.ink};">The VerifyMzansi Team</strong></p>
          </td></tr>
          ${ctaBlock}
          ${reasonBlock}

          <!-- Security note -->
          <tr><td class="vm-pad" style="padding:20px 40px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${C.green50};border:1px solid #cfeede;border-radius:14px;">
              <tr>
                <td style="padding:14px 0 14px 16px;vertical-align:top;width:28px;">
                  <img src="${escapeHtml(shieldUrl)}" width="24" height="24" alt="" style="display:block;width:24px;height:24px;border:0;">
                </td>
                <td style="padding:14px 16px 14px 10px;color:${C.green700};font-size:13px;line-height:1.55;">
                  <strong>Stay safe:</strong> VerifyMzansi will never ask for your password, OTP, card PIN or full card details by email.
                </td>
              </tr>
            </table>
          </td></tr>

          <!-- Footer -->
          <tr><td style="padding:0;">${flagStripe()}</td></tr>
          <tr><td class="vm-pad" align="center" style="padding:26px 40px 30px;background:${C.green950};color:rgba(255,255,255,0.68);font-size:13px;line-height:1.6;">
            <p style="margin:0 0 8px;">${escapeHtml(footerNote)}</p>
            <p style="margin:0 0 8px;">Questions? Email <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.gold300};font-weight:700;text-decoration:none;">${SUPPORT_EMAIL}</a></p>
            <p style="margin:0;color:#ffffff;font-weight:700;">${BRAND_NAME} <span style="color:rgba(255,255,255,0.55);font-weight:400;">· South Africa&#39;s trust-first marketplace</span></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
