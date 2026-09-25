const DEFAULT_CONTACT_EMAIL = "hello@verifymzansi.com";

function optionalPublicEnv(input: string | undefined): string | undefined {
  const value = input?.trim();
  return value ? value : undefined;
}

const GENERAL_CONTACT_EMAIL =
  optionalPublicEnv(process.env.NEXT_PUBLIC_VERIFYMZANSI_CONTACT_EMAIL) ?? DEFAULT_CONTACT_EMAIL;

export const HELLO_CONTACT_EMAIL =
  optionalPublicEnv(process.env.NEXT_PUBLIC_VERIFYMZANSI_HELLO_EMAIL) ?? GENERAL_CONTACT_EMAIL;

export const SUPPORT_CONTACT_EMAIL =
  optionalPublicEnv(process.env.NEXT_PUBLIC_VERIFYMZANSI_SUPPORT_EMAIL) ??
  "support@verifymzansi.com";

export const PRIVACY_CONTACT_EMAIL =
  optionalPublicEnv(process.env.NEXT_PUBLIC_VERIFYMZANSI_PRIVACY_EMAIL) ??
  "privacy@verifymzansi.com";

export const SECURITY_CONTACT_EMAIL =
  optionalPublicEnv(process.env.NEXT_PUBLIC_VERIFYMZANSI_SECURITY_EMAIL) ??
  "security@verifymzansi.com";

const BILLING_CONTACT_EMAIL = "billing@verifymzansi.com";
const VERIFICATION_CONTACT_EMAIL = "verification@verifymzansi.com";
const ABUSE_CONTACT_EMAIL = "abuse@verifymzansi.com";

export function supportReference(id: string): string {
  return `VM-${id.toUpperCase()}`;
}

export const CONTACT_CATEGORY_EMAILS = {
  fraud_report: ABUSE_CONTACT_EMAIL,
  verification_appeal: VERIFICATION_CONTACT_EMAIL,
  privacy_popia: PRIVACY_CONTACT_EMAIL,
  payment_refund: BILLING_CONTACT_EMAIL,
  security_vulnerability: SECURITY_CONTACT_EMAIL,
  business_claim: SUPPORT_CONTACT_EMAIL,
  organisation_proposal: HELLO_CONTACT_EMAIL,
  general_support: SUPPORT_CONTACT_EMAIL,
} as const;
