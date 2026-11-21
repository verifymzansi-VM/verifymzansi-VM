/**
 * Authority requests (staff): words and small pure helpers shared by the
 * pages, the route and the server adapter. Database update
 * 20261121043124_identity_record_disclosure.sql holds the rules: governors
 * and admins only, with an authenticator code from the last 15 minutes; the
 * log row is written before anything is shown; never a search by name; a
 * record closes 15 minutes after it was opened.
 */
import { normalizeSaPhone } from "@/lib/utils/phone";

export const AUTHORITY_REQUESTS_PATH = "/admin/authority-requests";
export const AUTHORITY_REQUESTS_ENDPOINT = "/api/admin/authority-requests";
export const AUTHORITY_SELFIE_ENDPOINT = "/api/admin/authority-requests/selfie";

/** How long a record stays open after it was opened, and how recent the
 * authenticator code must be (both 15 minutes in the database). */
export const DISCLOSURE_OPEN_MINUTES = 15;

export const REQUEST_TYPES = [
  { value: "subpoena", label: "Subpoena (Criminal Procedure Act, s205)" },
  { value: "court_order", label: "Court order" },
  { value: "warrant", label: "Search warrant" },
  { value: "police_case", label: "Written police request with a case number" },
  { value: "regulator", label: "Information Regulator or another body by law" },
] as const;
export type RequestType = (typeof REQUEST_TYPES)[number]["value"];

export const LOOKUP_KINDS = [
  {
    value: "post",
    label: "Post link",
    placeholder: "verifymzansi.co.za/listing/…",
    inputMode: "url",
  },
  { value: "id_number", label: "ID number", placeholder: "13 digits", inputMode: "numeric" },
  { value: "phone", label: "Phone number", placeholder: "082 123 4567", inputMode: "tel" },
  { value: "email", label: "Email address", placeholder: "name@example.co.za", inputMode: "email" },
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number]["value"];

export type DisclosureOutcome = "record" | "no_record" | "attempt_only" | "no_match";

export const OUTCOME_LABELS: Record<DisclosureOutcome, string> = {
  record: "Record found",
  no_record: "No record kept",
  attempt_only: "ID number only tried",
  no_match: "No match found",
};

/** "D-0042": the disclosure number staff quote. */
export function disclosureNumber(value: number): string {
  return `D-${String(value).padStart(4, "0")}`;
}

export function requestTypeLabel(value: string): string {
  return REQUEST_TYPES.find((type) => type.value === value)?.label ?? "Authority request";
}

export function lookupKindLabel(value: string): string {
  return LOOKUP_KINDS.find((kind) => kind.value === value)?.label ?? "Search";
}

/** Earlier requests: the status chip of one opening. */
export function earlierRequestStatus(row: {
  outcome: DisclosureOutcome;
  printed: boolean;
  viewed: boolean;
}): { label: string; tone: "success" | "muted" } {
  if (row.outcome === "no_match") return { label: "No match found", tone: "muted" };
  if (row.printed) return { label: "Printed", tone: "success" };
  if (row.viewed) return { label: "Viewed only", tone: "muted" };
  return { label: OUTCOME_LABELS[row.outcome], tone: "muted" };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{3,60}$/;
const POST_PATH = /^\/(?:listing|mzansi-business|tourism-events)\/([^/?#]+)\/?$/;

/**
 * The post id or link slug in what staff pasted: a full link to one of the
 * site's post pages (any host is accepted, the path decides), a path, or the
 * bare id or slug. Null when it is none of these.
 */
export function postReferenceFromLink(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 2048) return null;
  if (UUID.test(value)) return value.toLowerCase();
  if (SLUG.test(value)) return value;
  let path: string;
  try {
    path = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).pathname;
  } catch {
    return null;
  }
  const segment = POST_PATH.exec(path)?.[1];
  if (!segment) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (UUID.test(decoded)) return decoded.toLowerCase();
  return SLUG.test(decoded) ? decoded : null;
}

/** A South African mobile or landline number as +27XXXXXXXXX, or null. */
export function phoneForLookup(input: string): string | null {
  const value = normalizeSaPhone(input.trim());
  return /^\+27[0-9]{9}$/.test(value) ? value : null;
}

/** An email address in the form the database compares (trimmed, lower case). */
export function emailForLookup(input: string): string | null {
  const value = input.trim().toLowerCase();
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** "+27 71 234 5678" (no masking: staff read the full number here). */
export function formatDisclosurePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("27")
    ? `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
    : phone;
}

/** "800101 5009 08 7": an SA ID number split as on the ID book. */
export function formatIdNumber(value: string): string {
  return /^\d{13}$/.test(value)
    ? `${value.slice(0, 6)} ${value.slice(6, 10)} ${value.slice(10, 12)} ${value.slice(12)}`
    : value;
}

/** Whole minutes left until `until` (never below zero). */
export function minutesLeft(until: string | number, now = Date.now()): number {
  const end = typeof until === "number" ? until : new Date(until).getTime();
  return Math.max(0, Math.ceil((end - now) / 60000));
}

/** Refusals the screens word themselves (the route's `reason`). */
export const AUTHORITY_REQUEST_MESSAGES = {
  disclosure_request_type_invalid: "Choose the type of request.",
  disclosure_reference_required:
    "Enter the subpoena, court order or police case number (3 to 100 characters).",
  disclosure_requester_required: "Enter who is asking (3 to 200 characters).",
  disclosure_request_date_invalid:
    "Enter the date on the request. It can't be in the future or more than 5 years ago.",
  disclosure_reason_required: "Enter the reason for the request (10 to 2,000 characters).",
  disclosure_attestation_required:
    "Confirm that the request is genuine, signed, and names this person or this post.",
  disclosure_lookup_invalid: "Search by post link, ID number, phone number or email address.",
  disclosure_lookup_value_invalid:
    "Check the search value: a link to a post, a 13-digit SA ID number, an SA phone number or an email address.",
  disclosure_rate_limited:
    "You have opened 20 records in the last 24 hours. Ask another governor or admin, or try again later.",
  disclosure_unavailable:
    "This record isn't open for you. Records open only for the person who opened them, on the same sign-in.",
  disclosure_closed:
    "This record has closed. Open it again from Authority requests; that is logged again.",
  disclosure_not_allowed: "Only governors and admins can open authority requests.",
} as const;
export type AuthorityRequestRefusal = keyof typeof AUTHORITY_REQUEST_MESSAGES;
