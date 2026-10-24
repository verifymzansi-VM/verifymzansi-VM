import { expect, it } from "vitest";
import { foundationRecoveryClaim } from "./recovery-claims";
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
