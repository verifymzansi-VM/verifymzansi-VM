import { describe, expect, it } from "vitest";
import {
  SOCIAL_AUTHORIZATION_VERSION,
  derivePromotionSocialAuthorizationStatus,
  getPromotionSocialAuthorizationWriteResult,
} from "./social-authorization";

describe("promotion social authorization", () => {
  it("derives not_authorized when no authorization exists", () => {
    expect(
      derivePromotionSocialAuthorizationStatus({
        social_distribution_authorized: false,
        social_distribution_revoked_at: null,
      })
    ).toBe("not_authorized");
  });

  it("derives revoked when authorization was revoked", () => {
    expect(
      derivePromotionSocialAuthorizationStatus({
        social_distribution_authorized: false,
        social_distribution_revoked_at: "2026-03-23T10:00:00.000Z",
      })
    ).toBe("revoked");
  });

  it("marks new authorization grants correctly", () => {
    const nowIso = "2026-03-23T10:00:00.000Z";
    expect(
      getPromotionSocialAuthorizationWriteResult(
        {
          granted: true,
          authorizerName: "Nomsa Dlamini",
          authorizerRole: "Owner",
          relationship: "owner",
          monetizationAcknowledged: true,
        },
        null,
        nowIso
      )
    ).toMatchObject({
      social_distribution_authorized: true,
      social_distribution_authorized_at: nowIso,
      social_distribution_revoked_at: null,
      social_authorizer_name: "Nomsa Dlamini",
      social_authorizer_role: "Owner",
      social_authorizer_relationship: "owner",
      social_authorization_version: SOCIAL_AUTHORIZATION_VERSION,
      social_monetization_acknowledged: true,
      event: "granted",
    });
  });

  it("marks authorization updates when granted details change", () => {
    const result = getPromotionSocialAuthorizationWriteResult(
      {
        granted: true,
        authorizerName: "Nomsa Dlamini",
        authorizerRole: "Managing Director",
        relationship: "business_representative",
        monetizationAcknowledged: true,
      },
      {
        social_distribution_authorized: true,
        social_distribution_authorized_at: "2026-03-23T09:00:00.000Z",
        social_authorizer_name: "Nomsa Dlamini",
        social_authorizer_role: "Owner",
        social_authorizer_relationship: "owner",
        social_authorization_version: SOCIAL_AUTHORIZATION_VERSION,
        social_monetization_acknowledged: true,
      },
      "2026-03-23T10:00:00.000Z"
    );

    expect(result.event).toBe("updated");
    expect(result.social_distribution_authorized_at).toBe("2026-03-23T09:00:00.000Z");
  });

  it("preserves revocation timestamp when already revoked", () => {
    const result = getPromotionSocialAuthorizationWriteResult(
      { granted: false },
      {
        social_distribution_authorized: false,
        social_distribution_revoked_at: "2026-03-22T10:00:00.000Z",
      },
      "2026-03-23T10:00:00.000Z"
    );

    expect(result.social_distribution_revoked_at).toBe("2026-03-22T10:00:00.000Z");
    expect(result.event).toBeNull();
  });
});
