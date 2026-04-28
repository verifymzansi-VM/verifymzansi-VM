import "server-only";

export interface TrustPublicConfig {
  legalName?: string;
  tradingName?: string;
  cipcNumber?: string;
  businessAddress?: string;
  responsibleOfficer?: string;
  informationOfficerName?: string;
  informationOfficerEmail: string;
  informationOfficerPhone?: string;
  informationOfficerWhatsapp?: string;
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

type PublicConfigRowGroup = "identity" | "legal" | "contact";

const publicConfigRows = [
  { groups: ["identity", "legal"], key: "legalName", label: "Registered name" },
  { groups: ["identity", "legal"], key: "tradingName", label: "Trading name" },
  { groups: ["identity", "legal"], key: "cipcNumber", label: "CIPC registration number" },
  { groups: ["identity", "legal"], key: "businessAddress", label: "Registered address" },
  { groups: ["identity", "legal"], key: "responsibleOfficer", label: "Responsible officer" },
  {
    groups: ["identity", "legal"],
    key: "informationOfficerName",
    label: "Information Officer",
  },
  { groups: ["identity", "contact"], key: "informationOfficerEmail", label: "POPIA contact" },
  {
    groups: ["identity", "contact"],
    key: "informationOfficerPhone",
    label: "Information Officer phone",
  },
  {
    groups: ["identity", "contact"],
    key: "informationOfficerWhatsapp",
    label: "Information Officer WhatsApp",
  },
  { groups: ["identity", "contact"], key: "supportEmail", label: "Support email" },
  { groups: ["identity", "contact"], key: "supportPhone", label: "Support phone" },
  { groups: ["contact"], key: "securityEmail", label: "Security contact" },
] as const satisfies readonly {
  groups: readonly PublicConfigRowGroup[];
  key: keyof TrustPublicConfig;
  label: string;
}[];

function getConfiguredRows(config: TrustPublicConfig, group: PublicConfigRowGroup) {
  return publicConfigRows.flatMap((row): Array<{ label: string; value: string }> => {
    if (!(row.groups as readonly PublicConfigRowGroup[]).includes(group)) {
      return [];
    }

    const value = config[row.key];
    return value ? [{ label: row.label, value }] : [];
  });
}

export function getTrustPublicConfig(): TrustPublicConfig {
  return {
    legalName: envOrDefault("VERIFYMZANSI_LEGAL_NAME", "VERIFYMZANSI (PTY) LTD"),
    tradingName: envOrDefault("VERIFYMZANSI_TRADING_NAME", "VerifyMzansi"),
    cipcNumber: envOrDefault("VERIFYMZANSI_CIPC_NUMBER", "2026/155305/07"),
    businessAddress: envOrDefault(
      "VERIFYMZANSI_BUSINESS_ADDRESS",
      "Kwadlangezwa, Khandisa, Empangeni, KwaZulu-Natal, 3886"
    ),
    responsibleOfficer: envOrDefault("VERIFYMZANSI_RESPONSIBLE_OFFICER", "Senzo Mqondisi Mhlongo"),
    informationOfficerName: envOrDefault(
      "VERIFYMZANSI_INFORMATION_OFFICER_NAME",
      "Senzo Mqondisi Mhlongo"
    ),
    informationOfficerEmail: envOrDefault(
      "VERIFYMZANSI_INFORMATION_OFFICER_EMAIL",
      "privacy@verifymzansi.com"
    ),
    informationOfficerPhone: envOrDefault("VERIFYMZANSI_INFORMATION_OFFICER_PHONE", "0717484185"),
    informationOfficerWhatsapp: envOrDefault(
      "VERIFYMZANSI_INFORMATION_OFFICER_WHATSAPP",
      "0717484185"
    ),
    supportEmail: envOrDefault("VERIFYMZANSI_SUPPORT_EMAIL", "support@verifymzansi.com"),
    supportPhone:
      optionalEnv("VERIFYMZANSI_SUPPORT_PHONE") ??
      optionalEnv("VERIFYMZANSI_INFORMATION_OFFICER_PHONE"),
    securityEmail: envOrDefault("VERIFYMZANSI_SECURITY_EMAIL", "security@verifymzansi.com"),
    ozowMerchantName: envOrDefault("VERIFYMZANSI_OZOW_MERCHANT_NAME", "VerifyMzansi"),
    vatStatus: optionalEnv("VERIFYMZANSI_VAT_STATUS") ?? "VAT number not currently published",
  };
}

export function getConfiguredIdentityRows(config = getTrustPublicConfig()) {
  return getConfiguredRows(config, "identity");
}

export function getConfiguredLegalIdentityRows(config = getTrustPublicConfig()) {
  return getConfiguredRows(config, "legal");
}

export function getConfiguredContactRows(config = getTrustPublicConfig()) {
  return getConfiguredRows(config, "contact");
}
