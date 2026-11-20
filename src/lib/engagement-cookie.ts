import "server-only";

/**
 * The signed browser identifier of the view and like routes (cookie
 * `vmz_viewer`): `v1.<random UUID>.<issued, unix seconds>.<HMAC-SHA256>`,
 * signed with the Worker secret ENGAGEMENT_COOKIE_SECRET (at least 32
 * characters). Only an identifier this website issued is ever counted, so a
 * script cannot make up a new browser for every request; it is issued only
 * after a Turnstile check and within a per-address limit
 * (src/app/api/engagement/viewer/route.ts). Without the secret nothing is
 * issued or counted (fail closed).
 */

const VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** An identifier older than this (cookie lifetime plus slack) is not accepted. */
const ACCEPT_SECONDS = MAX_AGE_SECONDS + 60 * 60 * 24 * 35;
const FUTURE_SKEW_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export const VIEWER_COOKIE_MAX_AGE_SECONDS = MAX_AGE_SECONDS;

let cached: { raw: string; key: Promise<CryptoKey> } | null = null;

function signingKey(): Promise<CryptoKey> | null {
  const raw = process.env.ENGAGEMENT_COOKIE_SECRET?.trim();
  if (!raw || raw.length < 32) return null;
  if (cached?.raw !== raw)
    cached = {
      raw,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode(raw),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      ),
    };
  return cached.key;
}

/** Whether identifiers can be issued and checked (the secret is set). */
export function viewerSigningReady(): boolean {
  return signingKey() !== null;
}

async function signature(key: CryptoKey, id: string, issued: number) {
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${VERSION}|${id}|${issued}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Constant-time comparison of two strings of the same alphabet. */
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** A new signed identifier; null without the secret. */
export async function issueViewerToken(nowMs = Date.now()) {
  const key = signingKey();
  if (!key) return null;
  const id = crypto.randomUUID();
  const issued = Math.floor(nowMs / 1000);
  return { id, value: `${VERSION}.${id}.${issued}.${await signature(await key, id, issued)}` };
}

/** The identifier inside a cookie value this website signed, with when it
 * was issued, or null for anything else (unsigned, tampered, expired, from the
 * future, or no secret). */
export async function readViewerToken(
  value: string | undefined | null,
  nowMs = Date.now()
): Promise<{ id: string; issuedAt: Date } | null> {
  const key = signingKey();
  if (!key || !value || value.length > 120) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, id, issuedText, mac] = parts as [string, string, string, string];
  if (!UUID.test(id) || !/^\d{1,12}$/.test(issuedText)) return null;
  const issued = Number(issuedText);
  const now = Math.floor(nowMs / 1000);
  if (issued > now + FUTURE_SKEW_SECONDS || now - issued > ACCEPT_SECONDS) return null;
  return sameText(mac, await signature(await key, id, issued))
    ? { id, issuedAt: new Date(issued * 1000) }
    : null;
}
