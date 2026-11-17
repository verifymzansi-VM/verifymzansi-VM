import { expect, it } from "vitest";
import { foundationRecoveryClaim, foundationRecoveryOpened } from "./recovery-claims";
const sid = "00000000-0000-4000-8000-000000000001";
it("accepts a recent signed recovery method with bounded clock skew", () => {
  expect(foundationRecoveryClaim(sid, [{ method: "recovery", timestamp: 1000 }], 1010)).toEqual({
    sessionId: sid,
    issuedAt: 1000,
  });
  expect(foundationRecoveryClaim(sid, [{ method: "recovery", timestamp: 1020 }], 1000)).toEqual({
    sessionId: sid,
    issuedAt: 1020,
  });
});
it.each([
  undefined,
  [],
  [{ method: "password", timestamp: 1000 }],
  [{ method: "otp", timestamp: 1000 }],
  [{ method: "recovery", timestamp: 1000.5 }],
  [{ method: "recovery", timestamp: 1031 }],
  [{ method: "recovery", timestamp: -3000 }],
  "recovery",
])("does not turn ordinary or malformed authentication evidence into recovery: %j", (amr) => {
  expect(foundationRecoveryClaim(sid, amr, 1000)).toBeNull();
});
it("expires recovery independently of a refreshed access token", () => {
  expect(foundationRecoveryClaim(sid, [{ method: "recovery", timestamp: 1000 }], 4601)).toBeNull();
});
it("knows a session opened by a reset link at any age, and nothing else", () => {
  expect(foundationRecoveryOpened([{ method: "recovery", timestamp: 1 }])).toBe(true);
  // Any emailed link redeemed straight at Auth (a reset link shows otp there).
  expect(foundationRecoveryOpened([{ method: "otp", timestamp: 1 }])).toBe(true);
  expect(foundationRecoveryOpened([{ method: "magiclink", timestamp: 1 }])).toBe(true);
  expect(
    foundationRecoveryOpened([
      { method: "password", timestamp: 1 },
      { method: "recovery", timestamp: 2 },
    ])
  ).toBe(true);
  for (const amr of [
    undefined,
    null,
    [],
    "recovery",
    [{ method: "password" }],
    [{ method: "oauth", timestamp: 1 }],
    [{ method: "totp", timestamp: 1 }],
    [{ method: "email/signup", timestamp: 1 }],
    [null],
    ["recovery"],
  ])
    expect(foundationRecoveryOpened(amr)).toBe(false);
});
