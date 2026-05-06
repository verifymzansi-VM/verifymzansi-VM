const DEFAULT_CONTACT_EMAIL = "hello@verifymzansi.com";

function optionalPublicEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const GENERAL_CONTACT_EMAIL =
  optionalPublicEnv("NEXT_PUBLIC_VERIFYMZANSI_CONTACT_EMAIL") ?? DEFAULT_CONTACT_EMAIL;

export const HELLO_CONTACT_EMAIL =
  optionalPublicEnv("NEXT_PUBLIC_VERIFYMZANSI_HELLO_EMAIL") ?? GENERAL_CONTACT_EMAIL;

export const SUPPORT_CONTACT_EMAIL =
  optionalPublicEnv("NEXT_PUBLIC_VERIFYMZANSI_SUPPORT_EMAIL") ?? "support@verifymzansi.com";

export const PRIVACY_CONTACT_EMAIL =
  optionalPublicEnv("NEXT_PUBLIC_VERIFYMZANSI_PRIVACY_EMAIL") ?? "privacy@verifymzansi.com";

export const SECURITY_CONTACT_EMAIL =
  optionalPublicEnv("NEXT_PUBLIC_VERIFYMZANSI_SECURITY_EMAIL") ?? "security@verifymzansi.com";
