/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readRecoveryBinding,
  RecoveryBindingUnavailable,
  recoveryBindingCookieName,
  recoveryBindingCookieOptions,
  recoveryPageMarker,
  recoveryPageMatches,
  sealRecoveryBinding,
} from "./recovery-binding";

vi.mock("server-only", () => ({}));

const account = "00000000-0000-4000-8000-000000000001";
const session = "00000000-0000-4000-8000-000000000002";
const now = 1_800_000_000;
const app = "https://verifymzansi.com";

beforeEach(() => vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4)));
afterEach(() => vi.unstubAllEnvs());

const seal = (issuedAt = now, at = now) =>
  sealRecoveryBinding({ accountId: account, sessionId: session, issuedAt }, at);

it("binds one opened link to the verified account and session for at most 30 minutes", () => {
  const sealed = seal();
  expect(sealed.maxAge).toBe(1800);
  expect(sealed.marker).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(readRecoveryBinding(sealed.value, now + 1799)).toEqual({
    v: 1,
    account,
    session,
    marker: sealed.marker,
    expires: now + 1800,
  });
  expect(readRecoveryBinding(sealed.value, now + 1800)).toBeNull();
  // Each opening gets its own marker, even for the same session.
  expect(seal().marker).not.toBe(sealed.marker);
});

it("never outlives the hour in which the recovery method is accepted", () => {
  const sealed = seal(now - 3000);
  expect(sealed.maxAge).toBe(600);
  expect(readRecoveryBinding(sealed.value, now + 600)).toBeNull();
  expect(() => seal(now - 3600)).toThrow(RecoveryBindingUnavailable);
  expect(() => seal(now + 31)).toThrow(RecoveryBindingUnavailable);
  expect(() => seal(now + 0.5)).toThrow(RecoveryBindingUnavailable);
});

it("refuses ids that are not GoTrue uuids", () => {
  expect(() =>
    sealRecoveryBinding({ accountId: "someone", sessionId: session, issuedAt: now }, now)
  ).toThrow(RecoveryBindingUnavailable);
});

it("refuses a binding whose payload or signature was changed", () => {
  const { value } = seal();
  const [payload, mac] = value.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
  const forged = Buffer.from(
    JSON.stringify({ ...decoded, account: "00000000-0000-4000-8000-000000000009" })
  ).toString("base64url");
  const flipped = (mac[0] === "A" ? "B" : "A") + mac.slice(1);
  for (const candidate of [
    `${forged}.${mac}`,
    `${payload}.${flipped}`,
    `${payload}.${mac}.extra`,
    `${payload}`,
    `${payload}.${mac}x`,
    "",
    undefined,
    "a".repeat(600),
  ])
    expect(readRecoveryBinding(candidate, now)).toBeNull();
});

it("refuses a binding signed for another purpose or with another key", () => {
  const { value } = seal();
  vi.stubEnv("HMAC_SECRET", "fedcba9876543210".repeat(4));
  expect(readRecoveryBinding(value, now)).toBeNull();
});

it.each(["", "0".repeat(64), "abc", "g".repeat(64)])(
  "fails closed when the signing secret is missing or weak: %j",
  (secret) => {
    vi.stubEnv("HMAC_SECRET", secret);
    expect(() => seal()).toThrow(RecoveryBindingUnavailable);
    expect(() => readRecoveryBinding(`${"a".repeat(20)}.${"b".repeat(43)}`, now)).toThrow(
      RecoveryBindingUnavailable
    );
  }
);

it("uses a host-only, script-hidden, same-site cookie", () => {
  expect(recoveryBindingCookieName(app)).toBe("__Host-vm_recovery_binding");
  expect(recoveryBindingCookieOptions(app, 60)).toEqual({
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60,
  });
  // Plain-http local development cannot set Secure, so no prefix there.
  expect(recoveryBindingCookieName("http://127.0.0.1:55450")).toBe("vm_recovery_binding");
  expect(recoveryBindingCookieOptions("http://127.0.0.1:55450", 0).secure).toBe(false);
});

it.each([
  [`${app}/reset-password?link=AAAAAAAAAAAAAAAAAAAAAA`, "AAAAAAAAAAAAAAAAAAAAAA"],
  [
    `${app}/reset-password?vmzAuthCacheReset=1&link=AAAAAAAAAAAAAAAAAAAAAA`,
    "AAAAAAAAAAAAAAAAAAAAAA",
  ],
  [`${app}/reset-password?link=AAAAAAAAAAAAAAAAAAAAAA&link=BBBBBBBBBBBBBBBBBBBBBB`, null],
  [`${app}/reset-password?link=short`, null],
  [`${app}/reset-password?link=`, null],
  [`${app}/reset-password`, undefined],
  [`${app}/login?link=AAAAAAAAAAAAAAAAAAAAAA`, undefined],
  ["https://other.example/reset-password?link=AAAAAAAAAAAAAAAAAAAAAA", undefined],
  ["not a url", undefined],
  [null, undefined],
])("reads the reset page's link marker from %j", (referer, expected) => {
  expect(recoveryPageMarker(referer, app)).toBe(expected);
});

it("matches only the page opened by the latest link, or a page that sent no marker", () => {
  const sealed = seal();
  const binding = readRecoveryBinding(sealed.value, now)!;
  expect(recoveryPageMatches(binding, sealed.marker)).toBe(true);
  expect(recoveryPageMatches(binding, undefined)).toBe(true);
  expect(recoveryPageMatches(binding, seal().marker)).toBe(false);
  expect(recoveryPageMatches(binding, null)).toBe(false);
  expect(recoveryPageMatches(binding, sealed.marker.slice(1))).toBe(false);
});
