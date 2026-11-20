import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { encode } from "uqr";
import { z } from "zod";

/**
 * "Continue on your phone": the computer asks for a link, the website makes a
 * random 32-byte token and stores only its SHA-256 (api.start_capture_handoff).
 * The token travels in the link's #fragment, so it is never sent in a request
 * line, a server log or a Referer header. Opening the link on the phone uses it
 * once (api.redeem_capture_handoff) and gives that phone a second random secret,
 * the capture grant, in an HttpOnly cookie; again only its SHA-256 is stored.
 * The grant lets the phone take the photos for that one case and nothing else:
 * it is not a sign-in and reads nothing but a short public name.
 */
export const CAPTURE_GRANT_COOKIE = "vm_capture_grant";
/** The cookie is sent only to the phone's own routes. */
export const CAPTURE_GRANT_COOKIE_PATH = "/api/handoff";
const HANDOFF_PAGE_PATH = "/verify/continue";

/** A new random secret (32 bytes, base64url: 43 characters). */
export function newHandoffSecret() {
  return randomBytes(32).toString("base64url");
}
export const handoffSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Exact answer of api.redeem_capture_handoff and api.capture_handoff_context. */
export const captureHandoffStateSchema = z.strictObject({
  owner_id: z.uuid(),
  expires_at: z.string().min(1),
  public_name: z.string().min(1).max(120),
  needs_id: z.boolean(),
  needs_selfie: z.boolean(),
});
export type CaptureHandoffState = z.infer<typeof captureHandoffStateSchema>;

/** What the phone page is told: never the owner id. */
export function phoneHandoffView(state: CaptureHandoffState) {
  return {
    publicName: state.public_name,
    expiresAt: state.expires_at,
    needsId: state.needs_id,
    needsSelfie: state.needs_selfie,
  };
}

export function handoffLink(origin: string, token: string) {
  return `${new URL(HANDOFF_PAGE_PATH, origin).toString()}#${token}`;
}

/**
 * The link as a QR code, drawn by the website's server: one SVG path of dark
 * squares on a `size` x `size` grid (quiet zone included). No third-party
 * service or script sees the link.
 */
export function handoffQrCode(link: string) {
  const qr = encode(link, { ecc: "M", border: 4 });
  const size = qr.data.length;
  let path = "";
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    })
  );
  return { size, path };
}
