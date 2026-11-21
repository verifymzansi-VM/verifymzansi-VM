import current from "./terms-documents/posting-v5.json";

/**
 * The Terms page's text when the published posting terms cannot be read (no
 * foundation connection, for example in local previews): the sections of the
 * current version, posting-v5, word for word, plus the configured merchant
 * name under "Paying, VAT & invoices" (the Terms text itself states the VAT
 * status).
 */
export function buildTermsTextSections(trustConfig: { ozowMerchantName?: string }) {
  const configured = [
    trustConfig.ozowMerchantName
      ? `The checkout or bank record may show ${trustConfig.ozowMerchantName} as the Ozow merchant name.`
      : null,
  ].filter((line): line is string => line !== null);
  return current.sections.map((section) => ({
    id: section.id,
    navLabel: section.navLabel,
    title: section.title,
    content: section.id === "paying" ? [...section.content, ...configured] : [...section.content],
  }));
}
