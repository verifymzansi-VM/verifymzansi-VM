/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_TOKEN_TTL_MS,
  checkCaptureToken,
  grantChannel,
  issueCaptureToken,
  sessionChannel,
} from "./capture-token";

const binding = {
  accountId: "11111111-1111-4111-8111-111111111111",
  kind: "id_front" as const,
  channel: sessionChannel("22222222-2222-4222-8222-222222222222"),
};
const now = Date.parse("2026-11-20T12:00:00Z");

beforeEach(() => vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4)));
afterEach(() => vi.unstubAllEnvs());

describe("capture tokens", () => {
  it("accept a photo within 10 minutes of the camera starting", () => {
    const token = issueCaptureToken(binding, now);
    expect(token).toMatch(/^v1\.id_front\.\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(checkCaptureToken(token, binding, now)).toBe("ok");
    expect(checkCaptureToken(token, binding, now + CAPTURE_TOKEN_TTL_MS)).toBe("ok");
    expect(checkCaptureToken(token, binding, now + CAPTURE_TOKEN_TTL_MS + 1000)).toBe("expired");
  });

  it("refuse forged, edited and other people's tokens", () => {
    const token = issueCaptureToken(binding, now);
    const [v, kind, at, mac] = token.split(".");
    for (const forged of [
      null,
      "",
      `${v}.${kind}.${Number(at) + 600}.${mac}`,
      `${v}.selfie.${at}.${mac}`,
      `${v}.${kind}.${at}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`,
      `v2.${kind}.${at}.${mac}`,
    ])
      expect(checkCaptureToken(forged, binding, now)).toBe("invalid");
    // Another account, kind, sign-in session or a phone's grant.
    expect(
      checkCaptureToken(
        token,
        { ...binding, accountId: "33333333-3333-4333-8333-333333333333" },
        now
      )
    ).toBe("invalid");
    expect(checkCaptureToken(token, { ...binding, kind: "selfie" }, now)).toBe("invalid");
    expect(checkCaptureToken(token, { ...binding, channel: sessionChannel("other") }, now)).toBe(
      "invalid"
    );
    expect(
      checkCaptureToken(token, { ...binding, channel: grantChannel("a".repeat(64)) }, now)
    ).toBe("invalid");
    // A different server secret.
    vi.stubEnv("HMAC_SECRET", "fedcba9876543210".repeat(4));
    expect(checkCaptureToken(token, binding, now)).toBe("invalid");
  });

  it("refuse a token from well in the future", () => {
    const token = issueCaptureToken(binding, now + 5 * 60_000);
    expect(checkCaptureToken(token, binding, now)).toBe("invalid");
    expect(checkCaptureToken(issueCaptureToken(binding, now + 30_000), binding, now)).toBe("ok");
  });
});
