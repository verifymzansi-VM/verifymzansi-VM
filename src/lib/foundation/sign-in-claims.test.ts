import { describe, expect, it } from "vitest";
import {
  foundationAccountHasNoPassword,
  foundationLatestSignIn,
  foundationSignedInRecently,
  foundationSignedInWithPassword,
  foundationLatestAuthenticatorStep,
  foundationAuthenticatorStepRecent,
  RECENT_AUTHENTICATOR_SECONDS,
  RECENT_SIGN_IN_SECONDS,
} from "./sign-in-claims";

const now = 1_800_000_000;

describe("foundationLatestSignIn", () => {
  it.each(["oauth", "password", "otp", "magiclink"])("counts a %s sign-in", (method) => {
    expect(foundationLatestSignIn([{ method, timestamp: now - 10 }], now)).toBe(now - 10);
  });

  it.each([
    "totp",
    "recovery",
    "token_refresh",
    "email/signup",
    "invite",
    "email_change",
    "anonymous",
  ])("does not count %s as a sign-in", (method) => {
    expect(foundationLatestSignIn([{ method, timestamp: now - 10 }], now)).toBeNull();
  });

  it("takes the latest sign-in and ignores a newer second factor", () => {
    expect(
      foundationLatestSignIn(
        [
          { method: "totp", timestamp: now - 5 },
          { method: "oauth", timestamp: now - 7200 },
          { method: "password", timestamp: now - 600 },
        ],
        now
      )
    ).toBe(now - 600);
  });

  it.each([
    ["no claim", undefined],
    ["a non-array claim", { method: "oauth", timestamp: now }],
    ["a missing stamp", [{ method: "oauth" }]],
    ["a string stamp", [{ method: "oauth", timestamp: String(now) }]],
    ["a fractional stamp", [{ method: "oauth", timestamp: now - 0.5 }]],
    ["a zero stamp", [{ method: "oauth", timestamp: 0 }]],
    ["a stamp from the future", [{ method: "oauth", timestamp: now + 31 }]],
    ["junk entries", [null, 7, "oauth", { method: 1, timestamp: now }]],
  ])("reads %s as no sign-in", (_label, amr) => {
    expect(foundationLatestSignIn(amr, now)).toBeNull();
  });

  it("allows a little clock skew", () => {
    expect(foundationLatestSignIn([{ method: "oauth", timestamp: now + 30 }], now)).toBe(now + 30);
  });
});

describe("foundationSignedInRecently", () => {
  it("is the same hour a reset link's session may set a password in", () => {
    expect(RECENT_SIGN_IN_SECONDS).toBe(3600);
  });

  it.each([
    [now, true],
    [now - 3600, true],
    [now - 3601, false],
    [null, false],
  ])("signed in at %s: %s", (signedInAt, recent) => {
    expect(foundationSignedInRecently(signedInAt, now)).toBe(recent);
  });
});

describe("foundationLatestAuthenticatorStep", () => {
  it("takes only authenticator-app steps", () => {
    expect(
      foundationLatestAuthenticatorStep(
        [
          { method: "oauth", timestamp: now - 5 },
          { method: "totp", timestamp: now - 300 },
          { method: "mfa/phone", timestamp: now - 1 },
        ],
        now
      )
    ).toBe(now - 300);
    expect(
      foundationLatestAuthenticatorStep([{ method: "oauth", timestamp: now }], now)
    ).toBeNull();
    expect(
      foundationLatestAuthenticatorStep([{ method: "totp", timestamp: now + 31 }], now)
    ).toBeNull();
    expect(foundationLatestAuthenticatorStep(undefined, now)).toBeNull();
  });

  it("uses the database's 15 minutes for sensitive staff steps", () => {
    expect(RECENT_AUTHENTICATOR_SECONDS).toBe(900);
    expect(foundationAuthenticatorStepRecent(now - 900, now)).toBe(true);
    expect(foundationAuthenticatorStepRecent(now - 901, now)).toBe(false);
    expect(foundationAuthenticatorStepRecent(null, now)).toBe(false);
  });
});

describe("foundationSignedInWithPassword", () => {
  it.each([
    [[{ method: "password", timestamp: now - 86_400 }], true],
    [
      [
        { method: "oauth", timestamp: now },
        { method: "password", timestamp: now - 10 },
      ],
      true,
    ],
    [[{ method: "oauth", timestamp: now }], false],
    [
      [
        { method: "otp", timestamp: now },
        { method: "totp", timestamp: now },
      ],
      false,
    ],
    [[{ method: "recovery", timestamp: now }], false],
    [[null, "password", { provider: "password" }], false],
    [undefined, false],
    [{ method: "password" }, false],
  ])("%j: %s", (amr, password) => {
    expect(foundationSignedInWithPassword(amr)).toBe(password);
  });
});

describe("foundationAccountHasNoPassword", () => {
  const google = {
    id: "00000000-0000-4000-8000-000000000001",
    identities: [{ provider: "google", identity_data: { email: "member@example.invalid" } }],
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: {},
  };

  it("accepts an account GoTrue holds with only a Google identity", () => {
    expect(foundationAccountHasNoPassword(google)).toBe(true);
  });

  it.each([
    ["an email identity", { identities: [{ provider: "google" }, { provider: "email" }] }],
    ["only an email identity", { identities: [{ provider: "email" }] }],
    ["a phone identity", { identities: [{ provider: "google" }, { provider: "phone" }] }],
    [
      "email among the app providers",
      { app_metadata: { provider: "google", providers: ["google", "email"] } },
    ],
    ["email as the first provider", { app_metadata: { provider: "email", providers: ["google"] } }],
    ["no identities", { identities: [] }],
    ["unreadable identities", { identities: "google" }],
    ["an identity without a provider", { identities: [{ provider: "google" }, {}] }],
    ["an empty provider", { identities: [{ provider: "" }] }],
    ["no app metadata", { app_metadata: null }],
    ["no app provider list", { app_metadata: { provider: "google" } }],
    ["an empty app provider list", { app_metadata: { provider: "google", providers: [] } }],
    ["no first provider", { app_metadata: { providers: ["google"] } }],
    ["an SSO account", { is_sso_user: true }],
    ["an anonymous account", { is_anonymous: true }],
  ])("refuses (may have a password) with %s", (_label, change) => {
    expect(foundationAccountHasNoPassword({ ...google, ...change })).toBe(false);
  });

  it("ignores member-editable user metadata either way", () => {
    expect(
      foundationAccountHasNoPassword({
        ...google,
        user_metadata: {
          provider: "email",
          providers: ["email"],
          identities: [{ provider: "email" }],
        },
      })
    ).toBe(true);
    expect(
      foundationAccountHasNoPassword({
        ...google,
        identities: [{ provider: "email" }],
        user_metadata: { provider: "google", providers: ["google"] },
      })
    ).toBe(false);
  });

  it.each([null, undefined, "google", 1])("refuses a non-object %s", (value) => {
    expect(foundationAccountHasNoPassword(value)).toBe(false);
  });
});
