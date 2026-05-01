export type EmailTone = "success" | "info" | "warning" | "danger" | "neutral";

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
}

const BRAND_NAME = "VerifyMzansi";
const SUPPORT_EMAIL = "support@verifymzansi.com";
const DEFAULT_APP_URL = "https://verifymzansi.com";

const toneColors: Record<EmailTone, { accent: string; accentDark: string; soft: string }> = {
  success: { accent: "#0f9f6e", accentDark: "#087f5b", soft: "#ecfdf5" },
  info: { accent: "#2563eb", accentDark: "#1d4ed8", soft: "#eff6ff" },
  warning: { accent: "#d97706", accentDark: "#b45309", soft: "#fffbeb" },
  danger: { accent: "#dc2626", accentDark: "#b91c1c", soft: "#fef2f2" },
  neutral: { accent: "#111827", accentDark: "#030712", soft: "#f9fafb" },
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
  return `<p>${escapeHtml(text)}</p>`;
}

export function detailList(items: Array<[string, string]>): string {
  return `
    <div class="details">
      ${items
        .map(
          ([label, value]) => `
            <div class="detail-row">
              <span class="detail-label">${escapeHtml(label)}</span>
              <span class="detail-value">${escapeHtml(value)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

export function brandedEmail(params: BrandedEmailParams): string {
  const appUrl = sanitizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
  const tone = toneColors[params.tone ?? "info"];
  const logoUrl = `${appUrl}/images/logo.png`;
  const safeTitle = escapeHtml(params.title);
  const safeEyebrow = params.eyebrow ? escapeHtml(params.eyebrow) : BRAND_NAME;
  const safeIntro = escapeHtml(params.intro);
  const footerNote =
    params.footerNote ??
    "This email was sent by VerifyMzansi. We will never ask for your password or payment card details by email.";

  const renderCta = (cta: EmailCta, variant: "primary" | "secondary") => {
    const ctaTone = toneColors[cta.tone ?? params.tone ?? "info"];
    const background = variant === "primary" ? ctaTone.accent : "#ffffff";
    const color = variant === "primary" ? "#ffffff" : ctaTone.accentDark;
    const border = variant === "primary" ? ctaTone.accent : "#d1d5db";

    return `
      <a href="${escapeHtml(cta.href)}" class="button" style="background:${background};border-color:${border};color:${color};">
        ${escapeHtml(cta.label)}
      </a>
    `;
  };

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; padding: 0; background: #f3f4f6; color: #111827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; line-height: 1.6; }
      a { color: ${tone.accentDark}; }
      .wrapper { width: 100%; background: #f3f4f6; padding: 28px 12px; }
      .container { max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
      .brand { padding: 28px 32px 18px; text-align: center; background: #ffffff; }
      .logo { display: block; width: 176px; max-width: 80%; height: auto; margin: 0 auto; }
      .hero { padding: 28px 32px; background: ${tone.soft}; border-top: 4px solid ${tone.accent}; text-align: left; }
      .eyebrow { margin: 0 0 8px; color: ${tone.accentDark}; font-size: 13px; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
      h1 { margin: 0; color: #111827; font-size: 26px; line-height: 1.25; font-weight: 750; letter-spacing: 0; }
      .intro { margin: 14px 0 0; color: #374151; font-size: 16px; }
      .content { padding: 30px 32px 8px; font-size: 16px; }
      .content p { margin: 0 0 16px; }
      .content ul { margin: 0 0 18px 22px; padding: 0; }
      .content li { margin: 0 0 8px; }
      .details, .message-box { margin: 20px 0; padding: 18px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; }
      .message-box { border-left: 4px solid ${tone.accent}; white-space: pre-wrap; }
      .detail-row { display: table; width: 100%; padding: 9px 0; border-bottom: 1px solid #e5e7eb; }
      .detail-row:last-child { border-bottom: 0; }
      .detail-label, .detail-value { display: table-cell; vertical-align: top; }
      .detail-label { color: #6b7280; width: 42%; }
      .detail-value { color: #111827; font-weight: 700; text-align: right; }
      .cta { padding: 4px 32px 26px; text-align: center; }
      .button { display: inline-block; min-width: 132px; margin: 8px 4px 0; padding: 12px 20px; border: 1px solid; border-radius: 6px; font-weight: 700; text-decoration: none; }
      .reason { margin: 0 32px 24px; padding: 14px 16px; background: #f9fafb; border-left: 4px solid ${tone.accent}; color: #374151; }
      .footer { padding: 22px 32px 28px; color: #6b7280; font-size: 13px; text-align: center; background: #ffffff; border-top: 1px solid #e5e7eb; }
      .footer p { margin: 0 0 8px; }
      @media (max-width: 520px) {
        .wrapper { padding: 0; }
        .container { border-radius: 0; border-left: 0; border-right: 0; }
        .brand, .hero, .content, .cta, .footer { padding-left: 20px; padding-right: 20px; }
        h1 { font-size: 23px; }
        .detail-label, .detail-value { display: block; width: 100%; text-align: left; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="brand">
          <img class="logo" src="${escapeHtml(logoUrl)}" width="176" alt="VerifyMzansi">
        </div>
        <div class="hero">
          <p class="eyebrow">${safeEyebrow}</p>
          <h1>${safeTitle}</h1>
          <p class="intro">${safeIntro}</p>
        </div>
        <div class="content">
          ${params.bodyHtml}
          <p>Best regards,<br>The VerifyMzansi Team</p>
        </div>
        ${
          params.cta || params.secondaryCta
            ? `<div class="cta">${params.cta ? renderCta(params.cta, "primary") : ""}${params.secondaryCta ? renderCta(params.secondaryCta, "secondary") : ""}</div>`
            : ""
        }
        ${params.reason ? `<div class="reason"><strong>Why you received this:</strong> ${escapeHtml(params.reason)}</div>` : ""}
        <div class="footer">
          <p>${escapeHtml(footerNote)}</p>
          <p>Questions? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
          <p>${BRAND_NAME}, South Africa's trusted verification marketplace.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
