import "server-only";

export interface TrustPublicConfig {
  legalName?: string;
  cipcNumber?: string;
  businessAddress?: string;
  responsibleOfficer?: string;
  informationOfficerName?: string;
  informationOfficerEmail: string;
  supportEmail: string;
  supportPhone?: string;
  securityEmail: string;
  ozowMerchantName?: string;
  vatStatus?: string;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envOrDefault(name: string, fallback: string): string {
  return optionalEnv(name) ?? fallback;
}

export function getTrustPublicConfig(): TrustPublicConfig {
  return {
    legalName: optionalEnv("VERIFYMZANSI_LEGAL_NAME"),
    cipcNumber: optionalEnv("VERIFYMZANSI_CIPC_NUMBER"),
    businessAddress: optionalEnv("VERIFYMZANSI_BUSINESS_ADDRESS"),
    responsibleOfficer: optionalEnv("VERIFYMZANSI_RESPONSIBLE_OFFICER"),
    informationOfficerName: optionalEnv("VERIFYMZANSI_INFORMATION_OFFICER_NAME"),
    informationOfficerEmail: envOrDefault(
      "VERIFYMZANSI_INFORMATION_OFFICER_EMAIL",
      "privacy@verifymzansi.com"
    ),
    supportEmail: envOrDefault("VERIFYMZANSI_SUPPORT_EMAIL", "support@verifymzansi.com"),
    supportPhone: optionalEnv("VERIFYMZANSI_SUPPORT_PHONE"),
    securityEmail: envOrDefault("VERIFYMZANSI_SECURITY_EMAIL", "security@verifymzansi.com"),
    ozowMerchantName: optionalEnv("VERIFYMZANSI_OZOW_MERCHANT_NAME"),
    vatStatus: optionalEnv("VERIFYMZANSI_VAT_STATUS"),
  };
}

export function getConfiguredIdentityRows(config = getTrustPublicConfig()) {
  return [
    { label: "Registered name", value: config.legalName },
    { label: "CIPC registration number", value: config.cipcNumber },
    { label: "Business address", value: config.businessAddress },
    { label: "Responsible officer", value: config.responsibleOfficer },
    { label: "Information Officer", value: config.informationOfficerName },
    { label: "POPIA contact", value: config.informationOfficerEmail },
    { label: "Support email", value: config.supportEmail },
    { label: "Support phone", value: config.supportPhone },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}

export function getConfiguredLegalIdentityRows(config = getTrustPublicConfig()) {
  return [
    { label: "Registered name", value: config.legalName },
    { label: "CIPC registration number", value: config.cipcNumber },
    { label: "Business address", value: config.businessAddress },
    { label: "Responsible officer", value: config.responsibleOfficer },
    { label: "Information Officer", value: config.informationOfficerName },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}

export function getConfiguredContactRows(config = getTrustPublicConfig()) {
  return [
    { label: "POPIA contact", value: config.informationOfficerEmail },
    { label: "Support email", value: config.supportEmail },
    { label: "Support phone", value: config.supportPhone },
    { label: "Security contact", value: config.securityEmail },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}
