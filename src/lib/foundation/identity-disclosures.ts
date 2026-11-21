import "server-only";
import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { hasDatabaseMessage, hasDatabaseReason, isStaffSecondFactorRefusal } from "./error-reasons";
import type { FoundationRefusal } from "./owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "./staff-command";
import { readFoundationCookieToken, readUnverifiedFoundationTokenClaims } from "./request-api";
import { readFoundationRuntimeConnection } from "./runtime-connection";
import { foundationLatestAuthenticatorStep } from "./sign-in-claims";
import { verificationSecret } from "./verification-runtime";
import { sourceIdentityDigestToFingerprint } from "../domains/verification/identity-fingerprint";
import { validateSaIdChecksum } from "../utils/sa-id-validation";
import { getR2ObjectBytes } from "../services/storage";
import { decryptData } from "../utils/encryption";
import { createLogger } from "../utils/logger";
import { detectMimeFromMagicBytes } from "../utils/file-validation";
import {
  AUTHORITY_REQUEST_MESSAGES,
  AUTHORITY_REQUESTS_PATH,
  emailForLookup,
  phoneForLookup,
  postReferenceFromLink,
  type AuthorityRequestRefusal,
  type LookupKind,
  type RequestType,
} from "@/lib/admin/authority-requests";

/**
 * Authority requests (database update
 * 20261121043124_identity_record_disclosure.sql). Every command runs through
 * internal.staff_actor('identity:disclose'): governors and admins with an
 * authenticator code from the last 15 minutes. Opening writes the log row
 * and answers only its id; reading logs the look before it answers; a record
 * closes 15 minutes after it was opened. The ID number is decrypted and the
 * selfie read here, on the server, from the service-only material of a
 * disclosure that is still open for this staff member; browsers never see
 * stored object keys or ciphertext.
 */

type DatabaseError = { code?: string; message?: string; details?: string | null } | null;

/** A refusal the screens word themselves (AUTHORITY_REQUEST_MESSAGES). */
export class AuthorityRequestRefused extends Error {
  override name = "AuthorityRequestRefused";
  constructor(
    readonly status: number,
    readonly reason: AuthorityRequestRefusal
  ) {
    super(AUTHORITY_REQUEST_MESSAGES[reason]);
  }
}

const REASONS_22023 = [
  "disclosure_request_type_invalid",
  "disclosure_reference_required",
  "disclosure_requester_required",
  "disclosure_request_date_invalid",
  "disclosure_reason_required",
  "disclosure_attestation_required",
  "disclosure_lookup_invalid",
  "disclosure_lookup_value_invalid",
] as const;

/** Throws the refusal a database error stands for; unknown errors stay as
 * they are (the route answers them with a generic 503 and a reference). */
function refuse(error: NonNullable<DatabaseError>): never {
  if (error.code === "42501") {
    if (isStaffSecondFactorRefusal(error))
      throw new FoundationStaffCommandError(
        403,
        "Verify your authenticator again, then try again.",
        true
      );
    if (hasDatabaseMessage(error, "capabilityNotGranted"))
      throw new AuthorityRequestRefused(403, "disclosure_not_allowed");
    throw new FoundationStaffCommandError(
      403,
      "Your staff access changed. Reload the page before continuing."
    );
  }
  if (error.code === "22023")
    for (const reason of REASONS_22023)
      if (hasDatabaseReason(error, reason)) throw new AuthorityRequestRefused(422, reason);
  if (error.code === "PT409" && hasDatabaseReason(error, "disclosure_closed"))
    throw new AuthorityRequestRefused(410, "disclosure_closed");
  if (error.code === "PT409" && hasDatabaseReason(error, "disclosure_unavailable"))
    throw new AuthorityRequestRefused(404, "disclosure_unavailable");
  throw Object.assign(new Error("Authority request command failed"), { cause: error });
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Authority request answer could not be confirmed");
  return parsed.data;
}

const timestamp = z.iso.datetime({ offset: true });
const outcome = z.enum(["record", "no_record", "attempt_only", "no_match"]);
const requestType = z.enum(["subpoena", "court_order", "warrant", "police_case", "regulator"]);
const lookupKind = z.enum(["post", "id_number", "phone", "email"]);
const number = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const publicName = z.string().max(120).nullable();

const listResult = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        number,
        opened_at: timestamp,
        opened_by_name: publicName,
        request_type: requestType,
        reference: z.string().min(3).max(100),
        outcome,
        viewed: z.boolean(),
        printed: z.boolean(),
      })
    )
    .max(50),
});
const openResult = z.strictObject({
  disclosure_id: z.uuid(),
  number,
  outcome,
  match_count: z.number().int().nonnegative(),
  closes_at: timestamp,
});
const fileState = z.strictObject({
  kept: z.boolean(),
  taken_at: timestamp.nullable(),
  deleted_at: timestamp.nullable(),
});
const keptRecord = z.strictObject({
  account_id: z.uuid(),
  kept: z.literal(true),
  account_closed_at: timestamp.nullable(),
  legal_first_name: z.string().max(200).nullable(),
  legal_last_name: z.string().max(200).nullable(),
  verified_at: timestamp,
  verification_revoked_at: timestamp.nullable(),
  checked_by: z.enum(["staff_review", "other"]),
  id_number_kept: z.boolean(),
  id_number_erased_at: timestamp.nullable(),
  selfie: fileState,
  id_photo: fileState,
  phones: z
    .array(
      z.strictObject({
        phone: z.string().regex(/^\+27[0-9]{9}$/),
        verified_at: timestamp,
        revoked_at: timestamp.nullable(),
      })
    )
    .max(20),
});
const noRecord = z.strictObject({
  account_id: z.uuid(),
  kept: z.literal(false),
  account_closed_at: timestamp.nullable(),
});
const attempts = z.strictObject({
  account_id: z.uuid(),
  kept: z.literal(false),
  attempts: z.array(timestamp).max(20),
});
const readResult = z.strictObject({
  disclosure: z.strictObject({
    id: z.uuid(),
    number,
    opened_at: timestamp,
    closes_at: timestamp,
    opened_by_name: publicName,
    request_type: requestType,
    reference: z.string().min(3).max(100),
    requested_by: z.string().min(3).max(200),
    request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(10).max(2000),
    lookup_kind: lookupKind,
    lookup_value: z.string().max(254).nullable(),
    outcome,
    match_count: z.number().int().nonnegative(),
  }),
  records: z.array(z.union([keptRecord, attempts, noRecord])).max(5),
});
const encryptedNumber = z.strictObject({
  ciphertext: z.string().regex(/^[a-f0-9]{26}$/),
  iv: z.string().regex(/^[a-f0-9]{24}$/),
  tag: z.string().regex(/^[a-f0-9]{32}$/),
  key_id: z.literal("identity-number-v1"),
});
const materialResult = z.strictObject({
  disclosure_id: z.uuid(),
  records: z
    .array(
      z.strictObject({
        account_id: z.uuid(),
        submission_id: z.uuid(),
        encrypted_number: encryptedNumber.nullable(),
        selfie: z
          .strictObject({
            artifact_id: z.uuid(),
            case_id: z.uuid(),
            object_key: z.string().regex(/^evidence\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            size_bytes: z.number().int().positive().max(20000000),
          })
          .nullable(),
      })
    )
    .max(5),
});

export type DisclosureListItem = z.infer<typeof listResult>["items"][number];
export type DisclosureRead = z.infer<typeof readResult>;
/** `id_number_unreadable`: the number is kept but this server could not
 * decrypt it (a key mismatch); the rest of the record is still shown. */
export type DisclosureKeptRecord = z.infer<typeof keptRecord> & {
  id_number: string | null;
  id_number_unreadable: boolean;
};
export type DisclosureRecord =
  DisclosureKeptRecord | z.infer<typeof attempts> | z.infer<typeof noRecord>;

/** The latest 50 openings (no personal data about the person). */
export async function listIdentityDisclosures(api: FoundationAuthenticatedApi) {
  const { data, error } = await api.rpc("list_identity_disclosures", {}, { get: false });
  if (error) refuse(error);
  return parse(listResult, data).items;
}

/** What staff typed: checked and turned into what the database looks up. */
export type AuthorityRequestInput = {
  requestType: RequestType;
  reference: string;
  requestedBy: string;
  requestDate: string;
  reason: string;
  lookupKind: LookupKind;
  lookupValue: string;
  attested: boolean;
};

/** The ID number's one-way fingerprint, made exactly as at verification. */
export function identityNumberFingerprint(number: string, matchKey: Buffer) {
  return sourceIdentityDigestToFingerprint(
    createHmac("sha256", matchKey).update(number, "utf8").digest("hex")
  );
}

/** The value the database searches: a post id or slug, the ID number's
 * fingerprint (never the number), an E.164 phone number or an email address.
 * Never a name. */
export function lookupValueFor(kind: LookupKind, input: string): string {
  const value =
    kind === "post"
      ? postReferenceFromLink(input)
      : kind === "phone"
        ? phoneForLookup(input)
        : kind === "email"
          ? emailForLookup(input)
          : (() => {
              const digits = input.replace(/\s/g, "");
              return /^\d{13}$/.test(digits) && validateSaIdChecksum(digits)
                ? identityNumberFingerprint(digits, verificationSecret("HMAC_SECRET"))
                : null;
            })();
  if (!value) throw new AuthorityRequestRefused(422, "disclosure_lookup_value_invalid");
  return value;
}

/** Opens a record: the database writes the log row first and answers its id. */
export async function openIdentityDisclosure(
  api: FoundationAuthenticatedApi,
  input: AuthorityRequestInput
) {
  const { data, error } = await api.rpc(
    "open_identity_disclosure",
    {
      p_request_type: input.requestType,
      p_reference: input.reference,
      p_requested_by: input.requestedBy,
      p_request_date: input.requestDate,
      p_reason: input.reason,
      p_lookup_kind: input.lookupKind,
      p_lookup_value: lookupValueFor(input.lookupKind, input.lookupValue),
      p_attested: input.attested,
    },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(openResult, data);
  return {
    id: result.disclosure_id,
    number: result.number,
    outcome: result.outcome,
    matchCount: result.match_count,
    closesAt: result.closes_at,
  };
}

export async function closeIdentityDisclosure(api: FoundationAuthenticatedApi, id: string) {
  const { data, error } = await api.rpc(
    "close_identity_disclosure",
    { p_disclosure: z.uuid().parse(id) },
    { get: false }
  );
  if (error) refuse(error);
  return parse(z.strictObject({ disclosure_id: z.uuid(), closed: z.literal(true) }), data);
}

async function readDisclosure(
  api: FoundationAuthenticatedApi,
  id: string,
  purpose: "view" | "print" | "selfie",
  subject?: string
) {
  const { data, error } = await api.rpc(
    "read_identity_disclosure",
    {
      p_disclosure: z.uuid().parse(id),
      p_purpose: purpose,
      ...(subject ? { p_subject: z.uuid().parse(subject) } : {}),
    },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(readResult, data);
  if (result.disclosure.id !== id)
    throw new Error("Authority request answer could not be confirmed");
  return result;
}

async function readMaterial(service: FoundationServiceApi, id: string, staffId: string) {
  const { data, error } = await service.rpc("identity_disclosure_material", {
    p_disclosure: id,
    p_staff: staffId,
  });
  if (error) refuse(error);
  const result = parse(materialResult, data);
  if (result.disclosure_id !== id)
    throw new Error("Authority request answer could not be confirmed");
  return result.records;
}

function decryptNumber(owner: string, number: z.infer<typeof encryptedNumber>) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    verificationSecret("ID_ENCRYPTION_KEY"),
    Buffer.from(number.iv, "hex"),
    { authTagLength: 16 }
  );
  decipher.setAAD(Buffer.from(`${owner}:id_doc`, "utf8"));
  decipher.setAuthTag(Buffer.from(number.tag, "hex"));
  const value = Buffer.concat([
    decipher.update(Buffer.from(number.ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
  if (!/^\d{13}$/.test(value)) throw new Error("Authority request record could not be read");
  return value;
}

/**
 * The record of an open disclosure, for the record page (`view`) or the
 * printed sheet (`print`). The database logs the look before it answers; the
 * ID number is then decrypted here.
 */
export async function readIdentityDisclosure(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  staffId: string,
  id: string,
  purpose: "view" | "print"
): Promise<{ disclosure: DisclosureRead["disclosure"]; records: DisclosureRecord[] }> {
  const shown = await readDisclosure(api, id, purpose);
  const kept = shown.records.filter((record) => "verified_at" in record);
  const material = kept.length ? await readMaterial(service, id, staffId) : [];
  return {
    disclosure: shown.disclosure,
    records: shown.records.map((record) => {
      if (!("verified_at" in record)) return record;
      const found = material.find((item) => item.account_id === record.account_id);
      let number: string | null = null;
      let unreadable = false;
      if (record.id_number_kept && found?.encrypted_number) {
        try {
          number = decryptNumber(record.account_id, found.encrypted_number);
        } catch {
          // Logged without the record; the page says the number is kept but
          // could not be read, so staff never mistake it for "not kept".
          unreadable = true;
          createLogger("AuthorityRequests").error("Kept ID number could not be decrypted");
        }
      }
      return { ...record, id_number: number, id_number_unreadable: unreadable };
    }),
  };
}

/** The selfie of one person a disclosure names, decrypted for the screen. */
export async function readIdentityDisclosureSelfie(
  api: FoundationAuthenticatedApi,
  service: FoundationServiceApi,
  staffId: string,
  id: string,
  subject: string
) {
  await readDisclosure(api, id, "selfie", subject);
  const record = (await readMaterial(service, id, staffId)).find(
    (item) => item.account_id === subject
  );
  const selfie = record?.selfie;
  if (!selfie || !selfie.object_key.startsWith(`evidence/${selfie.case_id}/`)) return null;
  const stored = await getR2ObjectBytes(
    process.env.R2_PRIVATE_BUCKET || "verifymzansi-private",
    selfie.object_key
  );
  if (
    !stored ||
    stored.bytes.length !== selfie.size_bytes ||
    createHash("sha256").update(stored.bytes).digest("hex") !== selfie.sha256
  )
    throw new Error("Authority request selfie could not be read");
  const bytes = await decryptData(Buffer.from(stored.bytes));
  const mime = detectMimeFromMagicBytes(bytes);
  if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp")
    throw new Error("Authority request selfie could not be read");
  return bytes;
}

/**
 * When this staff session last used its authenticator app (seconds), for the
 * "open a record for N more minutes" hint only. Read from the session cookie
 * without verifying it; the database checks the real time on every command.
 */
export async function readStaffAuthenticatorHint(): Promise<number | null> {
  try {
    const connection = readFoundationRuntimeConnection();
    const store = await cookies();
    const token = await readFoundationCookieToken(connection, { getAll: () => store.getAll() });
    return foundationLatestAuthenticatorStep(
      readUnverifiedFoundationTokenClaims(connection, token).amr
    );
  } catch {
    return null;
  }
}

/** Route refusals: the screens' own reasons, the 15-minute re-verify
 * redirect, and any other malformed request as one. */
export function authorityRequestRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError)
    return {
      status: 422,
      error: "This request could not be read. Reload the page and try again.",
      reason: "disclosure_request_invalid",
    };
  if (error instanceof AuthorityRequestRefused)
    return { status: error.status, error: error.message, reason: error.reason };
  if (error instanceof FoundationStaffCommandError && error.mfaRequired)
    return {
      status: 403,
      error: error.message,
      reason: "staff_mfa_required",
      code: "step_up_required",
      redirectUrl: `/staff/two-step?confirm=1&next=${encodeURIComponent(AUTHORITY_REQUESTS_PATH)}`,
    };
  return staffCommandRefusal(error);
}
