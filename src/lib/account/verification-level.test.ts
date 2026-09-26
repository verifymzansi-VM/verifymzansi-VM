import { describe, expect, it } from "vitest";
import { getVerificationLevel } from "./verification-level";

const base = { emailConfirmed: false, phoneApproved: false, identityVerified: false };

describe("getVerificationLevel", () => {
  it("steps up from email to phone to identity", () => {
    expect(getVerificationLevel(base)).toBe("NONE");
    expect(getVerificationLevel({ ...base, emailConfirmed: true })).toBe("EMAIL_VERIFIED");
    expect(getVerificationLevel({ ...base, emailConfirmed: true, phoneApproved: true })).toBe(
      "PHONE_VERIFIED"
    );
    expect(getVerificationLevel({ ...base, phoneApproved: true, identityVerified: true })).toBe(
      "IDENTITY_VERIFIED"
    );
  });

  it("never lets an organisation role stand in for identity verification", () => {
    expect(
      getVerificationLevel({ ...base, phoneApproved: true, organisationAdministrator: true })
    ).toBe("PHONE_VERIFIED");
    expect(
      getVerificationLevel({ ...base, identityVerified: true, organisationAdministrator: true })
    ).toBe("ORGANISATION_REPRESENTATIVE_VERIFIED");
  });

  it("recognises enhanced verification on top of identity", () => {
    expect(getVerificationLevel({ ...base, identityVerified: true, enhancedVerified: true })).toBe(
      "ENHANCED_VERIFIED"
    );
  });
});
