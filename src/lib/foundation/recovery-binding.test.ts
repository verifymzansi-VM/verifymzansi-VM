/** @vitest-environment node */
import { createHmac, hkdfSync } from "node:crypto";
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

const SECRET = "0123456789abcdef".repeat(4);
beforeEach(() => vi.stubEnv("HMAC_SECRET", SECRET));
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

it("signs with a key derived by HKDF-SHA256 for this purpose only, never the raw secret", () => {
  const { value } = seal();
  const [payload, mac] = value.split(".");
  const derived = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(SECRET, "hex"),
      Buffer.alloc(0),
      "foundation-recovery-binding-v1",
      32
    )
  );
  expect(mac).toBe(createHmac("sha256", derived).update(payload).digest("base64url"));
  expect(mac).not.toBe(
    createHmac("sha256", Buffer.from(SECRET, "hex")).update(payload).digest("base64url")
  );
  // A key derived for another purpose does not verify it.
  const other = Buffer.from(
    hkdfSync("sha256", Buffer.from(SECRET, "hex"), Buffer.alloc(0), "another-purpose", 32)
  );
  expect(mac).not.toBe(createHmac("sha256", other).update(payload).digest("base64url"));
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

const M = "AAAAAAAAAAAAAAAAAAAAAA";
const preview = "https://preview.verifymzansi.workers.dev";
it.each([
  // The reset page an opened link leads to.
  [`${app}/reset-password?link=${M}`, M],
  [`${app}/reset-password/?link=${M}`, M],
  [`${app}/reset-password?vmzAuthCacheReset=1&link=${M}`, M],
  // The request's own host (www/apex, preview) counts as the site too.
  [`${preview}/reset-password?link=${M}`, M],
  // No page address, or one the browser trimmed to the bare origin.
  [null, undefined],
  ["", undefined],
  [`${app}/`, undefined],
  [`${preview}/`, undefined],
  // Anything no opening produced is refused.
  [`${app}/reset-password?link=${M}&link=BBBBBBBBBBBBBBBBBBBBBB`, null],
  [`${app}/reset-password?link=short`, null],
  [`${app}/reset-password?link=`, null],
  [`${app}/reset-password`, null],
  [`${app}/reset-password//?link=${M}`, null],
  [`${app}/?link=${M}`, null],
  [`${app}/login?link=${M}`, null],
  [`https://other.example/reset-password?link=${M}`, null],
  [`https://other.example/`, null],
  [`http://verifymzansi.com/reset-password?link=${M}`, null],
  ["not a url", null],
  [`${app}/reset-password?link=${M}&pad=${"x".repeat(2048)}`, null],
])("reads the reset page's link marker from %j", (referer, expected) => {
  expect(recoveryPageMarker(referer, [app, preview])).toBe(expected);
});

it("ignores an origin list entry that is not a URL", () => {
  expect(recoveryPageMarker(`${app}/reset-password?link=${M}`, ["not a url", app])).toBe(M);
  expect(recoveryPageMarker(`${app}/reset-password?link=${M}`, ["not a url"])).toBeNull();
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
