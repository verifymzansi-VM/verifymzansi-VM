import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { verificationSecret } from "./verification-runtime";

/**
 * The capture token (Didit plan, section 4): the verification page asks for
 * one when its camera starts, and the photo must reach the server within 10
 * minutes of it. Stateless: an HMAC with the server's existing HMAC_SECRET
 * (domain-separated), bound to the account, the photo kind and how the photo
 * is sent: the member's own sign-in session on the computer, or the phone's
 * capture grant (itself bound to one identity case). The identity case of a
 * first ID photo does not exist yet when the camera starts, so the session
 * stands in for it on that path.
 *
 * Like the other camera checks, this cannot prove a picture came from a live
 * camera; it refuses photos the page did not take recently.
 */
export type CaptureKind = "id_front" | "selfie";
export type CaptureBinding = { accountId: string; kind: CaptureKind; channel: string };

export const CAPTURE_TOKEN_TTL_MS = 10 * 60_000;
/** Clock difference tolerated for a token issued "in the future". */
const CLOCK_SKEW_MS = 60_000;
const TOKEN = /^v1\.(id_front|selfie)\.(\d{10})\.([A-Za-z0-9_-]{43})$/;

function mac(binding: CaptureBinding, issuedAt: number) {
  return createHmac("sha256", verificationSecret("HMAC_SECRET"))
    .update("capture-token-v1\0")
    .update(`${binding.accountId}\0${binding.kind}\0${binding.channel}\0${issuedAt}`)
    .digest("base64url");
}

/** A token for a camera that starts now (`now` in milliseconds). */
export function issueCaptureToken(binding: CaptureBinding, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  return `v1.${binding.kind}.${issuedAt}.${mac(binding, issuedAt)}`;
}

/** "ok", "expired" (older than 10 minutes) or "invalid" (anything else). */
export function checkCaptureToken(
  token: unknown,
  binding: CaptureBinding,
  now = Date.now()
): "ok" | "expired" | "invalid" {
  if (typeof token !== "string") return "invalid";
  const parts = TOKEN.exec(token);
  if (!parts || parts[1] !== binding.kind) return "invalid";
  const issuedAt = Number(parts[2]);
  const expected = Buffer.from(mac(binding, issuedAt));
  const given = Buffer.from(parts[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  const age = now - issuedAt * 1000;
  if (age < -CLOCK_SKEW_MS) return "invalid";
  return age > CAPTURE_TOKEN_TTL_MS ? "expired" : "ok";
}

/** The channel of a photo sent from the member's own signed-in session. */
export const sessionChannel = (sessionId: string) => `session:${sessionId}`;
/** The channel of a photo sent from a phone through its capture grant. */
export const grantChannel = (grantSha256: string) => `grant:${grantSha256}`;
