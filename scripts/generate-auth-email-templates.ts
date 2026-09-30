/**
 * Builds the Supabase Auth email templates in supabase/templates/ from the
 * same `brandedEmail` layout the app's own emails use, so every email the
 * platform sends looks the same. Go-template placeholders ({{ .Email }},
 * {{ .ConfirmationURL }}, ...) pass through untouched.
 *
 *   pnpm emails:auth-templates
 *
 * After regenerating, paste each file into Supabase Dashboard → Authentication
 * → Email Templates (hosted projects do not read config.toml).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brandedEmail, detailList, paragraph } from "../src/lib/services/email-template";

// brandedEmail reads this at call time for the shield image URL.
process.env.NEXT_PUBLIC_APP_URL = "https://verifymzansi.com";

const CONFIRM_URL = "{{ .ConfirmationURL }}";
const PRIVATE_LINK_NOTE =
  "This email was sent by VerifyMzansi. Keep this message private and do not forward account links.";

const templates: Record<string, string> = {
  "confirmation.html": brandedEmail({
    tone: "success",
    eyebrow: "Account confirmation",
    title: "Confirm your email address",
    intro: "Welcome to VerifyMzansi. One tap and your account is ready.",
    preheader: "Confirm your email address to finish setting up your VerifyMzansi account.",
    bodyHtml: [
      paragraph("Hi,"),
      paragraph(
        "Please confirm your email address to finish setting up your VerifyMzansi account."
      ),
      detailList([
        ["Email address", "{{ .Email }}"],
        ["Requested from", "VerifyMzansi"],
      ]),
      paragraph("If you did not create this account, you can safely ignore this email."),
    ].join(""),
    cta: { label: "Confirm email", href: CONFIRM_URL },
    reason: "A signup request used this email address on VerifyMzansi.",
    footerNote: PRIVATE_LINK_NOTE,
  }),

  "recovery.html": brandedEmail({
    tone: "warning",
    eyebrow: "Security notice",
    title: "Reset your password",
    intro:
      "A password reset was requested for your account. Use the link below only if this was you.",
    preheader: "Use this secure link to choose a new VerifyMzansi password.",
    bodyHtml: [
      paragraph("Hi,"),
      paragraph("Use the button below to choose a new password for your VerifyMzansi account."),
      detailList([
        ["Account email", "{{ .Email }}"],
        ["Action", "Password reset"],
      ]),
      paragraph(
        "If you did not request this reset, you can safely ignore this email. Your current password will remain unchanged."
      ),
    ].join(""),
    cta: { label: "Reset password", href: CONFIRM_URL },
    reason: "A password reset was requested for this email address on VerifyMzansi.",
    footerNote: PRIVATE_LINK_NOTE,
  }),

  "email-change.html": brandedEmail({
    tone: "info",
    eyebrow: "Email change confirmation",
    title: "Confirm your new email address",
    intro: "A request was made to change the email address on your VerifyMzansi account.",
    preheader: "Confirm the new email address for your VerifyMzansi account.",
    bodyHtml: [
      paragraph("Hi,"),
      paragraph(
        "Please confirm this new email address before we update your VerifyMzansi account."
      ),
      detailList([
        ["Current email", "{{ .Email }}"],
        ["New email", "{{ .NewEmail }}"],
      ]),
      paragraph(
        "If you did not request this change, do not click the confirmation button. Sign in and update your password, then contact support."
      ),
    ].join(""),
    cta: { label: "Confirm email change", href: CONFIRM_URL },
    reason: "An authenticated VerifyMzansi account requested an email address change.",
    footerNote: PRIVATE_LINK_NOTE,
  }),

  "email-changed-notification.html": brandedEmail({
    tone: "danger",
    eyebrow: "Security notice",
    title: "Your email address was changed",
    intro: "This confirms the email address on your VerifyMzansi account has changed.",
    preheader: "This is a security notice that your VerifyMzansi email address changed.",
    bodyHtml: [
      paragraph("Hi,"),
      paragraph("The email address for your VerifyMzansi account was changed."),
      detailList([
        ["Previous email", "{{ .OldEmail }}"],
        ["Current email", "{{ .Email }}"],
      ]),
      paragraph("If you made this change, no further action is needed."),
      paragraph(
        "If you did not make this change, reset your password immediately and contact support."
      ),
    ].join(""),
    cta: { label: "Reset password", href: "https://verifymzansi.com/forgot-password" },
    reason: "The email address connected to your VerifyMzansi account was changed.",
    footerNote: "This email was sent by VerifyMzansi as an account security notification.",
  }),
};

const dir = join(process.cwd(), "supabase", "templates");
for (const [file, html] of Object.entries(templates)) {
  writeFileSync(join(dir, file), html + "\n", "utf8");
  process.stdout.write(`wrote supabase/templates/${file}\n`);
}
