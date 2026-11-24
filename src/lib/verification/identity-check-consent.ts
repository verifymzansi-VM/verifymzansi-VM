/**
 * The member's consent to the automatic ID check (owner decision L, 20 Nov
 * 2026): the consent step says VerifyMzansi asks Didit, our independent
 * verification partner, to check the member's ID and face, and links Didit's
 * two notices. Safe in client components.
 *
 * The version names the consent words below. Change it whenever the words
 * change.
 */
export const IDENTITY_CHECK_CONSENT_VERSION = "identity-check-consent-v1";

/** Didit's notices for people it verifies (docs.didit.me, white label,
 * "Compliance responsibilities"). */
export const DIDIT_PRIVACY_NOTICE_URL = "https://didit.me/terms/verification-privacy-notice";
export const DIDIT_END_USER_TERMS_URL = "https://didit.me/terms/identity-verification";
