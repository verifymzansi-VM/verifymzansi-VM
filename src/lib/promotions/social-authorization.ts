import type { SocialAuthorizationStatus, SocialAuthorizerRelationship } from "@/types/enums";

export const SOCIAL_AUTHORIZATION_VERSION = "social_distribution_v1";

export interface PromotionSocialAuthorizationInput {
  granted: boolean;
  authorizerName?: string;
  authorizerRole?: string;
  relationship?: SocialAuthorizerRelationship;
  monetizationAcknowledged?: boolean;
  acceptedVersion?: string;
}

export interface PromotionSocialAuthorizationRecord {
  social_distribution_authorized?: boolean | null;
  social_distribution_authorized_at?: string | null;
  social_distribution_revoked_at?: string | null;
  social_authorizer_name?: string | null;
  social_authorizer_role?: string | null;
  social_authorizer_relationship?: SocialAuthorizerRelationship | null;
  social_authorization_version?: string | null;
  social_monetization_acknowledged?: boolean | null;
}

export interface PromotionSocialAuthorizationWriteResult extends PromotionSocialAuthorizationRecord {
  event: "granted" | "updated" | "revoked" | null;
}

export const SOCIAL_AUTHORIZATION_COPY = {
  sectionTitle: "External Social Distribution Authorization",
  grantLabel: "Authorized for VerifyMzansi social posting",
  pendingLabel: "Not authorized yet",
  summary:
    "You can publish the promotion on VerifyMzansi without this. Authorization only controls whether VerifyMzansi may post it on VerifyMzansi-owned social channels.",
  licenseAcknowledgement:
    "I confirm I have the right to let VerifyMzansi publish, adapt, and distribute this promotion on VerifyMzansi-owned social channels.",
  monetizationAcknowledgement:
    "I understand monetization from VerifyMzansi-owned channels or posts belongs to VerifyMzansi unless a separate written agreement says otherwise.",
  versionAcceptance: "I accept the current External Social Distribution Authorization terms.",
} as const;

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRelationship(
  value?: SocialAuthorizerRelationship | null
): SocialAuthorizerRelationship {
  return value ?? "owner";
}

export function derivePromotionSocialAuthorizationStatus(
  promotion: Pick<
    PromotionSocialAuthorizationRecord,
    "social_distribution_authorized" | "social_distribution_revoked_at"
  >
): SocialAuthorizationStatus {
  if (promotion.social_distribution_authorized) {
    return "authorized";
  }

  if (promotion.social_distribution_revoked_at) {
    return "revoked";
  }

  return "not_authorized";
}

export function getPromotionSocialAuthorizationWriteResult(
  input: PromotionSocialAuthorizationInput | undefined,
  previous: PromotionSocialAuthorizationRecord | null,
  nowIso = new Date().toISOString()
): PromotionSocialAuthorizationWriteResult {
  const nextGranted = input?.granted === true;
  const previousGranted = previous?.social_distribution_authorized === true;

  if (!nextGranted) {
    return {
      social_distribution_authorized: false,
      social_distribution_authorized_at: previous?.social_distribution_authorized_at ?? null,
      social_distribution_revoked_at: previousGranted
        ? nowIso
        : (previous?.social_distribution_revoked_at ?? null),
      social_authorizer_name: null,
      social_authorizer_role: null,
      social_authorizer_relationship: "owner",
      social_authorization_version: null,
      social_monetization_acknowledged: false,
      event: previousGranted ? "revoked" : null,
    };
  }

  const nextState = {
    social_distribution_authorized: true,
    social_distribution_authorized_at: previousGranted
      ? (previous?.social_distribution_authorized_at ?? nowIso)
      : nowIso,
    social_distribution_revoked_at: null,
    social_authorizer_name: normalizeText(input.authorizerName),
    social_authorizer_role: normalizeText(input.authorizerRole),
    social_authorizer_relationship: normalizeRelationship(input.relationship),
    social_authorization_version: SOCIAL_AUTHORIZATION_VERSION,
    social_monetization_acknowledged: input.monetizationAcknowledged === true,
  } satisfies PromotionSocialAuthorizationRecord;

  const existingState = {
    social_authorizer_name: normalizeText(previous?.social_authorizer_name),
    social_authorizer_role: normalizeText(previous?.social_authorizer_role),
    social_authorizer_relationship: normalizeRelationship(previous?.social_authorizer_relationship),
    social_authorization_version: previous?.social_authorization_version ?? null,
    social_monetization_acknowledged: previous?.social_monetization_acknowledged === true,
  };

  const changedWhileGranted =
    previousGranted &&
    (existingState.social_authorizer_name !== nextState.social_authorizer_name ||
      existingState.social_authorizer_role !== nextState.social_authorizer_role ||
      existingState.social_authorizer_relationship !== nextState.social_authorizer_relationship ||
      existingState.social_authorization_version !== nextState.social_authorization_version ||
      existingState.social_monetization_acknowledged !==
        nextState.social_monetization_acknowledged);

  return {
    ...nextState,
    event: previousGranted ? (changedWhileGranted ? "updated" : null) : "granted",
  };
}
