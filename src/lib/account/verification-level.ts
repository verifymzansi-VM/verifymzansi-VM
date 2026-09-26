/**
 * Verification level of a person/account. Independent of any plan: a plan can
 * expire while verification stays valid. Organisations can never award these
 * levels; the representative level only adds to a completed identity check.
 */
export type VerificationLevel =
  | "NONE"
  | "EMAIL_VERIFIED"
  | "PHONE_VERIFIED"
  | "IDENTITY_VERIFIED"
  | "ENHANCED_VERIFIED"
  | "ORGANISATION_REPRESENTATIVE_VERIFIED";

export interface VerificationLevelInput {
  emailConfirmed: boolean;
  phoneApproved: boolean;
  /** VerifyMzansi identity review completed (account status `verified`). */
  identityVerified: boolean;
  /** Step-up check completed (e.g. liveness with an external provider). */
  enhancedVerified?: boolean;
  /** Authorised administrator of a VerifyMzansi organisation. */
  organisationAdministrator?: boolean;
}

export const VERIFICATION_LEVEL_LABELS: Record<VerificationLevel, string> = {
  NONE: "Not verified",
  EMAIL_VERIFIED: "Email verified",
  PHONE_VERIFIED: "Phone verified",
  IDENTITY_VERIFIED: "Identity verified",
  ENHANCED_VERIFIED: "Enhanced verification",
  ORGANISATION_REPRESENTATIVE_VERIFIED: "Organisation representative verified",
};

export function getVerificationLevel(input: VerificationLevelInput): VerificationLevel {
  if (input.identityVerified) {
    if (input.organisationAdministrator) return "ORGANISATION_REPRESENTATIVE_VERIFIED";
    if (input.enhancedVerified) return "ENHANCED_VERIFIED";
    return "IDENTITY_VERIFIED";
  }
  if (input.phoneApproved) return "PHONE_VERIFIED";
  if (input.emailConfirmed) return "EMAIL_VERIFIED";
  return "NONE";
}
