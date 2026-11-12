import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Server-side memory of the recovery session a reset link opened in this
 * browser. The recovery callback writes it right after GoTrue has verified the
 * exchanged session; the reset handler reads it to supply the recovery session
 * id that the strict completion check needs (the restored reset page sends only
 * the two password fields).
 *
 * - Cookie: HttpOnly, SameSite=Strict, Path=/, `__Host-` prefixed and Secure on
 *   https, signed (HMAC-SHA256) with a key derived for this purpose only
 *   (HKDF from HMAC_SECRET), at most 30 minutes and never past
 *   the hour in which GoTrue accepts the recovery method. Cleared after a
 *   successful reset, so one opened link completes at most one reset.
 * - Bound to the GoTrue-verified account and session id: another account,
 *   another session or a session without a verified recovery method cannot use
 *   it, and it is useless in another browser.
 * - Each opening also gets a random marker, which the callback puts into the
 *   reset page address (`/reset-password?link=...`). Both tabs share one cookie
 *   jar, so only the page address tells an older reset page from a newer one:
 *   the browser sends it with the page's own requests (Referer, under the
 *   site's strict-origin-when-cross-origin policy). A page whose marker is not
 *   the latest opening's is refused ("your recovery session changed"), and so
 *   is any page address that no opening produced.
 *
 * The marker is not a secret and grants nothing on its own; the signed cookie
 * and the recovery session cookies are both required.
 */

const COOKIE = "vm_recovery_binding";
export const RECOVERY_PAGE_PATH = "/reset-password";
export const RECOVERY_LINK_PARAM = "link";
const LIFETIME_SECONDS = 30 * 60;
/** The same window foundationRecoveryClaim and the password resetter accept. */
const RECOVERY_WINDOW_SECONDS = 60 * 60;
const MARKER = /^[A-Za-z0-9_-]{22}$/;
/** HKDF info: the binding key is derived for this purpose only. */
const KEY_INFO = "foundation-recovery-binding-v1";

const binding = z.strictObject({
  v: z.literal(1),
  account: z.uuid(),
  session: z.uuid(),
  marker: z.string().regex(MARKER),
  expires: z.number().int().positive(),
});
export type RecoveryBinding = z.infer<typeof binding>;

/** The signing secret is missing or malformed; recovery fails closed. */
export class RecoveryBindingUnavailable extends Error {
  override name = "RecoveryBindingUnavailable";
  constructor() {
    super("Recovery binding is unavailable");
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** HKDF-SHA256 (RFC 5869) with an empty salt and one 32-byte block: a key used
 * for nothing else, derived from the shared HMAC_SECRET. Built on createHmac,
 * which every runtime this site uses provides. */
function bindingKey(): Buffer {
  const secret = process.env.HMAC_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret) || new Set(secret.toLowerCase()).size < 8)
    throw new RecoveryBindingUnavailable();
  const prk = createHmac("sha256", Buffer.alloc(32)).update(Buffer.from(secret, "hex")).digest();
  return createHmac("sha256", prk)
    .update(KEY_INFO)
    .update(Buffer.from([1]))
    .digest();
}

function signature(payload: string): Buffer {
  return createHmac("sha256", bindingKey()).update(payload).digest();
}

/** `__Host-` only on https: the prefix requires Secure, which plain-http local
 * development cannot set. Reader and writer derive it from the same app origin. */
export function recoveryBindingCookieName(appOrigin: string): string {
  return appOrigin.startsWith("https://") ? `__Host-${COOKIE}` : COOKIE;
}

export function recoveryBindingCookieOptions(appOrigin: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: appOrigin.startsWith("https://"),
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

/** Call only with a GoTrue-verified account, session and recovery timestamp. */
export function sealRecoveryBinding(
  input: { accountId: string; sessionId: string; issuedAt: number },
  now = nowSeconds()
) {
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt > now + 30)
    throw new RecoveryBindingUnavailable();
  const expires = Math.min(now + LIFETIME_SECONDS, input.issuedAt + RECOVERY_WINDOW_SECONDS);
  if (expires <= now) throw new RecoveryBindingUnavailable();
  const parsed = binding.safeParse({
    v: 1,
    account: input.accountId,
    session: input.sessionId,
    marker: randomBytes(16).toString("base64url"),
    expires,
  });
  if (!parsed.success) throw new RecoveryBindingUnavailable();
  const payload = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  return {
    value: `${payload}.${signature(payload).toString("base64url")}`,
    marker: parsed.data.marker,
    maxAge: expires - now,
  };
}

/** A live binding with a valid signature, or null. Throws only when the signing
 * secret is unavailable. */
export function readRecoveryBinding(
  value: string | undefined,
  now = nowSeconds()
): RecoveryBinding | null {
  if (!value || value.length > 512) return null;
  const parts = value.split(".");
  if (
    parts.length !== 2 ||
    !/^[A-Za-z0-9_-]{1,400}$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  )
    return null;
  const supplied = Buffer.from(parts[1], "base64url");
  const expected = signature(parts[0]);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = binding.safeParse(decoded);
  return parsed.success && parsed.data.expires > now ? parsed.data : null;
}

/**
 * Which opening the requesting reset page belongs to, from the page address
 * the browser sent (Referer). `origins` are the site's own: the configured app
 * origin and the request's (www/apex and preview hosts).
 * - a marker: the reset page opened by that link;
 * - undefined: no page address at all, or one the browser's privacy settings
 *   trimmed to the bare origin. Tabs cannot be told apart, so only the
 *   session binding applies;
 * - null (refused): anything else, i.e. an address that is too long,
 *   unreadable, from another origin or another page, or the reset page with a
 *   missing, repeated or malformed marker. No opening produced such a page.
 */
export function recoveryPageMarker(
  referer: string | null,
  origins: readonly string[]
): string | null | undefined {
  if (referer === null || referer === "") return undefined;
  if (referer.length > 2048) return null;
  let page: URL;
  try {
    page = new URL(referer);
  } catch {
    return null;
  }
  const own = origins.flatMap((origin) => {
    try {
      return [new URL(origin).origin];
    } catch {
      return [];
    }
  });
  if (!own.includes(page.origin)) return null;
  if (page.pathname === "/" && !page.search && !page.hash) return undefined;
  const path = page.pathname.endsWith("/") ? page.pathname.slice(0, -1) : page.pathname;
  if (path !== RECOVERY_PAGE_PATH) return null;
  const markers = page.searchParams.getAll(RECOVERY_LINK_PARAM);
  return markers.length === 1 && MARKER.test(markers[0]) ? markers[0] : null;
}

/** Whether the requesting page belongs to this binding's opening. */
export function recoveryPageMatches(binding: RecoveryBinding, marker: string | null | undefined) {
  if (marker === undefined) return true;
  if (marker === null) return false;
  const supplied = Buffer.from(marker);
  const expected = Buffer.from(binding.marker);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
