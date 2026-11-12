import current from "./terms-documents/posting-v4.json";

/**
 * The Terms page's text when the published posting terms cannot be read (no
 * foundation connection, for example in local previews): the sections of the
 * current version, posting-v4, word for word, plus the configured merchant
 * name and VAT status under "Paying, VAT & invoices".
 */
export function buildTermsTextSections(trustConfig: {
  ozowMerchantName?: string;
  vatStatus?: string;
}) {
  const configured = [
    trustConfig.ozowMerchantName
      ? `The checkout or bank record may show ${trustConfig.ozowMerchantName} as the Ozow merchant name.`
      : null,
    trustConfig.vatStatus ? `VAT status: ${trustConfig.vatStatus}.` : null,
  ].filter((line): line is string => line !== null);
  return current.sections.map((section) => ({
    id: section.id,
    navLabel: section.navLabel,
    title: section.title,
    content: section.id === "paying" ? [...section.content, ...configured] : [...section.content],
  }));
}
