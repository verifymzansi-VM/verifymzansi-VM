/** @vitest-environment node */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { getR2ObjectBytes } from "../services/storage";
import { decryptData } from "../utils/encryption";
import { processIdentityNumber } from "../domains/verification/identity-processing";
import { FoundationStaffCommandError } from "./staff-command";
import {
  AuthorityRequestRefused,
  authorityRequestRefusal,
  listIdentityDisclosures,
  lookupValueFor,
  openIdentityDisclosure,
  readIdentityDisclosure,
  readIdentityDisclosureSelfie,
} from "./identity-disclosures";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("../services/storage", () => ({ uploadToR2: vi.fn(), getR2ObjectBytes: vi.fn() }));
vi.mock("../utils/encryption", () => ({ encryptData: vi.fn(), decryptData: vi.fn() }));

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const DISCLOSURE = id("1");
const STAFF = id("2");
const OWNER = id("3");
const CASE = id("4");
const AT = "2026-11-21T08:00:00.123456+00:00";
const ID_NUMBER = "8001015009087";
const MATCH_KEY = randomBytes(32).toString("hex");

const rpc = vi.fn();
const machine = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const service = { rpc: machine } as unknown as FoundationServiceApi;

const request = {
  requestType: "subpoena" as const,
  reference: "CAS 123/11/2026",
  issuedBy: "Richards Bay Magistrate's Court",
  confirmedNumber: "035 789 1234",
  confirmedBy: "Ms T. Zulu, clerk of the court",
  reason: "Fraud investigation into a reported listing.",
  lookupKind: "phone" as const,
  lookupValue: "082 123 4567",
  attested: true,
};

function disclosure(outcome = "record") {
  return {
    id: DISCLOSURE,
    number: 42,
    opened_at: AT,
    closes_at: "2026-11-21T08:15:00.123456+00:00",
    opened_by_name: "Senzo N.",
    request_type: "subpoena",
    reference: "CAS 123/11/2026",
    reason: "Fraud investigation into a reported listing.",
    lookup_kind: "phone",
    lookup_value: "+27821234567",
    outcome,
    match_count: outcome === "no_match" ? 0 : 1,
  };
}
const keptRecord = {
  account_id: OWNER,
  kept: true,
  account_closed_at: null,
  legal_first_name: "Thando Sipho",
  legal_last_name: "Dlamini",
  verified_at: AT,
  verification_revoked_at: null,
  checked_by: "staff_review",
  id_number_kept: true,
  id_number_erased_at: null,
  selfie: { kept: true, taken_at: AT, deleted_at: null },
  id_photo: { kept: false, taken_at: AT, deleted_at: AT },
  phones: [{ phone: "+27821234567", verified_at: AT, revoked_at: null }],
};

let encryptedNumber: Record<string, string>;
const selfieStored = Buffer.from("synthetic encrypted selfie");
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  const key = randomBytes(32);
  const iv = randomBytes(12);
  vi.stubEnv("ID_ENCRYPTION_KEY", key.toString("hex"));
  vi.stubEnv("HMAC_SECRET", MATCH_KEY);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${OWNER}:id_doc`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(ID_NUMBER), cipher.final()]);
  encryptedNumber = {
    ciphertext: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    key_id: "identity-number-v1",
  };
  machine.mockResolvedValue({
    data: {
      disclosure_id: DISCLOSURE,
      records: [
        {
          account_id: OWNER,
          submission_id: id("5"),
          encrypted_number: encryptedNumber,
          selfie: {
            artifact_id: id("6"),
            case_id: CASE,
            object_key: `evidence/${CASE}/${id("6")}`,
            sha256: createHash("sha256").update(selfieStored).digest("hex"),
            size_bytes: selfieStored.length,
          },
        },
      ],
    },
    error: null,
  });
});

describe("authority requests: what is searched", () => {
  it("sends an ID number only as the fingerprint made at verification, never the number", () => {
    const value = lookupValueFor("id_number", "800101 5009 08 7");
    expect(value).not.toContain(ID_NUMBER);
    expect(value).toBe(
      processIdentityNumber(OWNER, ID_NUMBER, {
        identityMatchKey: MATCH_KEY,
        numberEncryptionKey: "0123456789abcdef".repeat(4),
        identityKeyId: "identity-match-v1",
        encryptionKeyId: "identity-number-v1",
      }).fingerprint
    );
  });

  it("refuses an invalid ID number, a name, and a foreign phone number", () => {
    for (const [kind, value] of [
      ["id_number", "8001015009088"],
      ["id_number", "Thando Dlamini"],
      ["phone", "Thando"],
      ["email", "Thando Dlamini"],
      ["post", "Thando Dlamini"],
    ] as const) {
      expect(() => lookupValueFor(kind, value)).toThrow(AuthorityRequestRefused);
    }
  });

  it("opens through api.open_authority_request and returns only the log row", async () => {
    rpc.mockResolvedValue({
      data: {
        disclosure_id: DISCLOSURE,
        number: 42,
        outcome: "record",
        match_count: 1,
        closes_at: AT,
      },
      error: null,
    });
    await expect(openIdentityDisclosure(api, request)).resolves.toEqual({
      id: DISCLOSURE,
      number: 42,
      outcome: "record",
      matchCount: 1,
      closesAt: AT,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "open_authority_request",
      {
        p_request_type: "subpoena",
        p_reference: "CAS 123/11/2026",
        p_issued_by: "Richards Bay Magistrate's Court",
        p_confirmed_number: "035 789 1234",
        p_confirmed_by: "Ms T. Zulu, clerk of the court",
        p_reason: "Fraud investigation into a reported listing.",
        p_lookup_kind: "phone",
        p_lookup_value: "+27821234567",
        p_attested: true,
      },
      { get: false }
    );
  });

  it("does not call the database for a search value it cannot use", async () => {
    await expect(
      openIdentityDisclosure(api, { ...request, lookupKind: "email", lookupValue: "Thando" })
    ).rejects.toMatchObject({ reason: "disclosure_lookup_value_invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an answer that carries more than the log row", async () => {
    rpc.mockResolvedValue({
      data: {
        disclosure_id: DISCLOSURE,
        number: 42,
        outcome: "record",
        match_count: 1,
        closes_at: AT,
        legal_last_name: "Dlamini",
      },
      error: null,
    });
    await expect(openIdentityDisclosure(api, request)).rejects.toThrow("could not be confirmed");
  });
});

describe("authority requests: refusals", () => {
  const refusalOf = async (error: Record<string, string>) => {
    rpc.mockResolvedValue({ data: null, error });
    try {
      await openIdentityDisclosure(api, request);
    } catch (thrown) {
      return { thrown, route: authorityRequestRefusal(thrown) };
    }
    throw new Error("expected a refusal");
  };

  it("words each database reason", async () => {
    for (const [code, reason, status] of [
      ["22023", "disclosure_attestation_required", 422],
      ["22023", "disclosure_lookup_invalid", 422],
      ["22023", "disclosure_reference_required", 422],
      ["22023", "disclosure_issued_by_required", 422],
      ["22023", "disclosure_confirmed_number_required", 422],
      ["22023", "disclosure_confirmed_by_required", 422],
      ["22023", "disclosure_selfie_withheld", 422],
      ["PT409", "disclosure_closed", 410],
      ["PT409", "disclosure_unavailable", 404],
    ] as const) {
      const { route } = await refusalOf({ code, message: "x", details: reason });
      expect(route).toMatchObject({ status, reason });
    }
  });

  it("sends staff whose code is older than 15 minutes to confirm it, then back", async () => {
    const { thrown, route } = await refusalOf({
      code: "42501",
      message: "recent second-factor verification required",
    });
    expect(thrown).toBeInstanceOf(FoundationStaffCommandError);
    expect(route).toMatchObject({
      status: 403,
      code: "step_up_required",
      redirectUrl: "/staff/two-step?confirm=1&next=%2Fadmin%2Fauthority-requests",
    });
  });

  it("tells moderators the page is for governors and admins", async () => {
    const { route } = await refusalOf({ code: "42501", message: "capability not granted" });
    expect(route).toMatchObject({ status: 403, reason: "disclosure_not_allowed" });
  });

  it("leaves unknown failures to the route's generic answer", async () => {
    const { route } = await refusalOf({ code: "XX000", message: "boom" });
    expect(route).toBeNull();
    expect(authorityRequestRefusal(new z.ZodError([]))).toMatchObject({ status: 422 });
  });
});

describe("authority requests: reading a record", () => {
  it("lists earlier requests without the person", async () => {
    rpc.mockResolvedValue({
      data: {
        items: [
          {
            id: DISCLOSURE,
            number: 42,
            opened_at: AT,
            opened_by_name: "Senzo N.",
            request_type: "subpoena",
            reference: "CAS 123/11/2026",
            outcome: "record",
            viewed: true,
            printed: false,
          },
        ],
      },
      error: null,
    });
    const items = await listIdentityDisclosures(api);
    expect(items).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith("list_identity_disclosures", {}, { get: false });
  });

  it("reads (logged in the database first), then decrypts the ID number on the server", async () => {
    rpc.mockResolvedValue({
      data: { disclosure: disclosure(), records: [keptRecord] },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view");
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "read_identity_disclosure",
      { p_disclosure: DISCLOSURE, p_purpose: "view" },
      { get: false }
    );
    expect(machine).toHaveBeenCalledExactlyOnceWith("identity_disclosure_material", {
      p_disclosure: DISCLOSURE,
      p_staff: STAFF,
    });
    // The read comes before the material: nothing is shown without the log.
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(machine.mock.invocationCallOrder[0]);
    expect(result.records[0]).toMatchObject({ id_number: ID_NUMBER, legal_last_name: "Dlamini" });
  });

  it("reads an urgent request: its confirmation, no selfie or ID photo", async () => {
    const { selfie: _selfie, id_photo: _photo, ...minimal } = keptRecord;
    rpc.mockResolvedValue({
      data: {
        disclosure: {
          ...disclosure(),
          request_type: "urgent_life_risk",
          issued_by: "Richards Bay SAPS",
          confirmed_number: "035 901 7000",
          confirmed_by: "W/O N. Mthembu",
        },
        records: [minimal],
      },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view");
    expect(result.disclosure).toMatchObject({
      request_type: "urgent_life_risk",
      issued_by: "Richards Bay SAPS",
    });
    expect(result.records[0]).not.toHaveProperty("selfie");
    expect(result.records[0]).toMatchObject({ id_number: ID_NUMBER });
  });

  it("strips a selfie or ID photo from an urgent record, even if the answer carried one", async () => {
    rpc.mockResolvedValue({
      data: {
        disclosure: {
          ...disclosure(),
          request_type: "urgent_life_risk",
          issued_by: "Richards Bay SAPS",
          confirmed_number: "035 901 7000",
          confirmed_by: "W/O N. Mthembu",
        },
        records: [keptRecord],
      },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "print");
    expect(result.records[0]).not.toHaveProperty("selfie");
    expect(result.records[0]).not.toHaveProperty("id_photo");
    expect(result.records[0]).toMatchObject({ id_number: ID_NUMBER });
  });

  it("never reads the selfie of an urgent record", async () => {
    rpc.mockResolvedValue({
      data: {
        disclosure: { ...disclosure(), request_type: "urgent_life_risk" },
        records: [keptRecord],
      },
      error: null,
    });
    await expect(
      readIdentityDisclosureSelfie(api, service, STAFF, DISCLOSURE, OWNER)
    ).resolves.toBeNull();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "x", details: "disclosure_selfie_withheld" },
    });
    await expect(
      readIdentityDisclosureSelfie(api, service, STAFF, DISCLOSURE, OWNER)
    ).resolves.toBeNull();
    expect(machine).not.toHaveBeenCalled();
    expect(getR2ObjectBytes).not.toHaveBeenCalled();
  });

  it("still reads a record opened before rule D9 (earlier request type)", async () => {
    rpc.mockResolvedValue({
      data: { disclosure: { ...disclosure(), request_type: "police_case" }, records: [keptRecord] },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view");
    expect(result.disclosure.request_type).toBe("police_case");
  });

  it("still shows the record when the kept number cannot be decrypted, and says so", async () => {
    rpc.mockResolvedValue({
      data: { disclosure: disclosure(), records: [keptRecord] },
      error: null,
    });
    vi.stubEnv("ID_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view");
    expect(result.records[0]).toMatchObject({
      id_number: null,
      id_number_unreadable: true,
      legal_last_name: "Dlamini",
    });
  });

  it("fetches no material when nothing is kept", async () => {
    rpc.mockResolvedValue({
      data: { disclosure: disclosure("no_match"), records: [] },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "print");
    expect(result.records).toEqual([]);
    expect(machine).not.toHaveBeenCalled();
  });

  it("shows no ID number once it is erased", async () => {
    rpc.mockResolvedValue({
      data: {
        disclosure: disclosure(),
        records: [{ ...keptRecord, id_number_kept: false, id_number_erased_at: AT }],
      },
      error: null,
    });
    const result = await readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view");
    expect(result.records[0]).toMatchObject({ id_number: null });
  });

  it("refuses a record that is closed and does not read the material", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PT409", message: "disclosure closed", details: "disclosure_closed" },
    });
    await expect(
      readIdentityDisclosure(api, service, STAFF, DISCLOSURE, "view")
    ).rejects.toMatchObject({ reason: "disclosure_closed" });
    expect(machine).not.toHaveBeenCalled();
  });

  it("serves the selfie only after the database logged the look, checking its hash", async () => {
    rpc.mockResolvedValue({
      data: { disclosure: disclosure(), records: [keptRecord] },
      error: null,
    });
    vi.mocked(getR2ObjectBytes).mockResolvedValue({ bytes: new Uint8Array(selfieStored) });
    vi.mocked(decryptData).mockResolvedValue(jpeg);
    const bytes = await readIdentityDisclosureSelfie(api, service, STAFF, DISCLOSURE, OWNER);
    expect(bytes).toEqual(jpeg);
    expect(rpc).toHaveBeenCalledWith(
      "read_identity_disclosure",
      { p_disclosure: DISCLOSURE, p_purpose: "selfie", p_subject: OWNER },
      { get: false }
    );
    expect(getR2ObjectBytes).toHaveBeenCalledWith(
      "verifymzansi-private",
      `evidence/${CASE}/${id("6")}`
    );
    vi.mocked(getR2ObjectBytes).mockResolvedValue({ bytes: new Uint8Array(Buffer.from("other")) });
    await expect(
      readIdentityDisclosureSelfie(api, service, STAFF, DISCLOSURE, OWNER)
    ).rejects.toThrow("could not be read");
  });
});
