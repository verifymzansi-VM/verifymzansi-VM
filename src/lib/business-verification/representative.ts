import crypto from "crypto";

/**
 * Company representative route (spec §3.3): a non-director proves they act
 * for the company with (1) a code sent to a work mailbox on the company's own
 * domain and (2) a call-back staff make to a number they find themselves.
 * Letters of authority are never accepted.
 */

export type RepresentativeState = {
  email?: string | null;
  position?: string | null;
  codeHash?: string | null;
  codeExpiresAt?: string | null;
  attempts?: number;
  emailVerifiedAt?: string | null;
  domainConfirmed?: boolean;
  callback?: {
    numberSource: string;
    spokeTo: string;
    confirmedPosition: string;
    confirmed: boolean;
    notes: string | null;
    by: string;
    at: string;
  } | null;
  confirmed?: boolean;
};

export const CODE_TTL_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;

/** Free and ISP mailboxes don't prove anything about a company. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.za",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.za",
  "live.com",
  "live.co.za",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "webmail.co.za",
  "mweb.co.za",
  "telkomsa.net",
  "vodamail.co.za",
  "absamail.co.za",
  "iafrica.com",
  "lantic.net",
  "cybersmart.co.za",
  "afrihost.co.za",
  "polka.co.za",
  "pm.me",
  "mac.com",
  "yahoo.co.uk",
  "hotmail.co.uk",
  "outlook.co.za",
  "gmx.net",
  "yandex.com",
  "mail.ru",
  "tutanota.com",
  "fastmail.com",
  // Throwaway inboxes.
  "mailinator.com",
  "guerrillamail.com",
  "sharklasers.com",
  "10minutemail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
]);

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0
    ? email
        .slice(at + 1)
        .trim()
        .toLowerCase()
    : null;
}

export function isWorkEmail(email: string): boolean {
  const domain = emailDomain(email);
  return Boolean(domain && domain.includes(".") && !FREE_MAIL_DOMAINS.has(domain));
}

function codeSecret(): string {
  const secret = process.env.HMAC_SECRET || process.env.IP_HASH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("HMAC_SECRET is required to issue work-email codes");
  }
  return secret || "dev-only-work-email-codes";
}

export function hashCode(caseId: string, code: string): string {
  return crypto.createHmac("sha256", codeSecret()).update(`${caseId}:${code}`).digest("hex");
}

export function newCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function codesMatch(expectedHash: string, caseId: string, code: string): boolean {
  const actual = Buffer.from(hashCode(caseId, code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Confirmed only when every check is done; recomputed on each change. */
export function isRepresentativeConfirmed(state: RepresentativeState): boolean {
  return Boolean(state.emailVerifiedAt && state.domainConfirmed && state.callback?.confirmed);
}
