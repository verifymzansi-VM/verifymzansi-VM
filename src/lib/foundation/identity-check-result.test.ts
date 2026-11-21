/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import { fetchDiditDecision, fetchDiditImage, type DiditDecision } from "./didit-client";
import { networkHash } from "./identity-check-context";
import {
  comparableName,
  namesMatch,
  outcomeOf,
  recordIdentityCheckResult,
} from "./identity-check-result";
import { putImmutableR2Bytes } from "../services/storage";
vi.mock("server-only", () => ({}));
vi.mock("./didit-client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchDiditDecision: vi.fn(),
  fetchDiditImage: vi.fn(),
}));
vi.mock("./verification-runtime", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cleanEvidence: vi.fn(async (file: File) => Buffer.from(await file.arrayBuffer())),
}));
vi.mock("../services/storage", () => ({ putImmutableR2Bytes: vi.fn() }));
vi.mock("../utils/encryption", () => ({
  encryptData: vi.fn(async (b: Buffer) => Buffer.concat([Buffer.from("enc:"), b])),
  decryptData: vi.fn(async (b: Buffer) => b.subarray(4)),
}));

const check = "11111111-1111-4111-8111-111111111111";
const session = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const idArtifact = "44444444-4444-4444-8444-444444444444";
const selfieArtifact = "55555555-5555-4555-8555-555555555555";
const caseId = "66666666-6666-4666-8666-666666666666";
const adult = "8001015009087";
const child = "1501015009083";
const config = { apiKey: "fixture-key", workflowId: "77777777-7777-4777-8777-777777777777" };
const names = { first_name: "Thando Sipho", last_name: "Dlamini" };
/** What the database recorded when the member started (begin_identity_check_evidence). */
const start = () => ({ ...names, network_hash: networkHash("198.51.100.7"), device_kind: "phone" });
const rpc = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;

function decision(overrides: Partial<DiditDecision> = {}): DiditDecision {
  return {
    session_id: session,
    status: "Approved",
    vendor_data: check,
    id_verifications: [
      {
        first_name: "THANDO SIPHO",
        last_name: "DLAMINI",
        personal_number: adult,
        issuing_state: "ZAF",
        front_image: "https://images.partner.example/front.jpg?sig=1",
      },
    ],
    liveness_checks: [{ reference_image: "https://images.partner.example/face.jpg?sig=1" }],
    ip_analyses: [{ ip_address: "198.51.100.42", platform: "mobile" }],
    ...overrides,
  };
}
const completion = () => rpc.mock.calls.find(([name]) => name === "complete_identity_check")?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  vi.stubEnv("ID_ENCRYPTION_KEY", "fedcba9876543210".repeat(4));
  vi.mocked(fetchDiditImage).mockImplementation(async (url) => Buffer.from(`photo:${url}`));
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, _key, bytes) => bytes);
  rpc.mockImplementation(async (name: string) => {
    switch (name) {
      case "begin_identity_check_evidence":
        return {
          data: {
            owner_id: owner,
            start: start(),
            id_front: { artifact_id: idArtifact, object_key: `evidence/${caseId}/${idArtifact}` },
            selfie: {
              artifact_id: selfieArtifact,
              object_key: `evidence/${caseId}/${selfieArtifact}`,
            },
          },
          error: null,
        };
      case "assess_identity_upload":
        return { data: { blocked: false, risk_score: 0 }, error: null };
      case "complete_identity_check":
        return { data: { status: "approved", submission_id: idArtifact }, error: null };
    }
    throw new Error(`unexpected ${name}`);
  });
});

describe("the partner's status", () => {
  it("maps to a result, or to nothing while the session is still going", () => {
    expect(outcomeOf("Approved")).toBe("approved");
    expect(outcomeOf("Declined")).toBe("declined");
    expect(outcomeOf("In Review")).toBe("in_review");
    expect(outcomeOf("Expired")).toBe("not_finished");
    expect(outcomeOf("Abandoned")).toBe("not_finished");
    for (const going of [
      "Not Started",
      "In Progress",
      "Awaiting User",
      "Resubmitted",
      "Kyc Expired",
    ])
      expect(outcomeOf(going)).toBeNull();
  });
});

describe("names (typed versus the ID)", () => {
  it("are compared without regard to case, Unicode form or spacing", () => {
    expect(namesMatch(names, { first_name: "THANDO  SIPHO", last_name: "dlamini" })).toBe(true);
    // The same letters composed differently (NFC typed, NFD on the ID).
    expect(
      namesMatch(
        { first_name: "Zo" + String.fromCodePoint(0xeb), last_name: "Ndlovu" },
        { first_name: "ZOE" + String.fromCodePoint(0x308), last_name: "NDLOVU" }
      )
    ).toBe(true);
    expect(namesMatch(names, { first_name: "THANDO", last_name: "DLAMINI" })).toBe(false);
    expect(namesMatch(names, { first_name: null, last_name: "DLAMINI" })).toBe(false);
    expect(comparableName(" Ａnna ")).toBe("anna");
  });
});

describe("recording a result", () => {
  it("records a clean pass with the photos, the encrypted number and exactly the start names", async () => {
    vi.mocked(fetchDiditDecision).mockResolvedValue(decision());
    expect(await recordIdentityCheckResult(service, config, session)).toEqual({
      recorded: true,
      status: "approved",
    });
    const args = completion();
    expect(args).toMatchObject({
      p_check: check,
      p_session_id: session,
      p_outcome: "approved",
      p_reasons: [],
      p_names: { first_name: "Thando Sipho", last_name: "Dlamini" },
      p_risk_score: 0,
      p_id_front: {
        size: expect.any(Number),
        stored_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(args.p_identity.encrypted_number.key_id).toBe("identity-number-v1");
    expect(JSON.stringify(args)).not.toContain(adult);
    expect(rpc).toHaveBeenCalledWith(
      "assess_identity_upload",
      expect.objectContaining({ p_owner: owner })
    );
    expect(putImmutableR2Bytes).toHaveBeenCalledWith(
      expect.any(String),
      `evidence/${caseId}/${idArtifact}`,
      expect.any(Buffer)
    );
  });

  it("adds session_moved when the check happened on another network or device (scam lure)", async () => {
    for (const seen of [
      [{ ip_address: "203.0.113.9", platform: "mobile" }],
      [{ ip_address: "198.51.100.42", platform: "desktop" }],
      [],
    ]) {
      rpc.mockClear();
      vi.mocked(fetchDiditDecision).mockResolvedValue(decision({ ip_analyses: seen }));
      await recordIdentityCheckResult(service, config, session);
      expect(completion()).toMatchObject({ p_outcome: "approved", p_reasons: ["session_moved"] });
    }
    // The partner's outcome is passed as it is.
    rpc.mockClear();
    vi.mocked(fetchDiditDecision).mockResolvedValue(
      decision({
        status: "Declined",
        ip_analyses: [{ ip_address: "203.0.113.9", platform: "mobile" }],
      })
    );
    await recordIdentityCheckResult(service, config, session);
    expect(completion()).toMatchObject({ p_outcome: "declined", p_reasons: ["session_moved"] });
  });

  it("adds names_differ and document_not_accepted from the ID", async () => {
    const [document] = decision().id_verifications!;
    vi.mocked(fetchDiditDecision).mockResolvedValue(
      decision({ id_verifications: [{ ...document!, first_name: "THANDO", issuing_state: "LSO" }] })
    );
    await recordIdentityCheckResult(service, config, session);
    expect(completion()).toMatchObject({
      p_outcome: "approved",
      p_reasons: ["names_differ", "document_not_accepted"],
      p_names: { first_name: "Thando Sipho", last_name: "Dlamini" },
    });
  });

  it("keeps nothing from an invalid or under-18 ID number, or a session with nothing to review", async () => {
    const [document] = decision().id_verifications!;
    const cases: [Partial<DiditDecision>, string[]][] = [
      [
        { id_verifications: [{ ...document!, personal_number: "8001015009088" }] },
        ["id_number_invalid"],
      ],
      [{ id_verifications: [{ ...document!, personal_number: child }] }, ["under_18"]],
      [{ status: "Declined", liveness_checks: [] }, []],
      [{ status: "Expired" }, []],
    ];
    for (const [overrides, reasons] of cases) {
      rpc.mockClear();
      vi.mocked(fetchDiditDecision).mockResolvedValue(decision(overrides));
      await recordIdentityCheckResult(service, config, session);
      expect(completion()).toEqual({
        p_check: check,
        p_session_id: session,
        p_outcome: "not_finished",
        p_reasons: reasons,
      });
      expect(rpc).not.toHaveBeenCalledWith("begin_identity_check_evidence", expect.anything());
    }
    expect(fetchDiditImage).not.toHaveBeenCalled();
  });

  it("does nothing while the session is still going, and refuses a session that is not ours", async () => {
    vi.mocked(fetchDiditDecision).mockResolvedValue(decision({ status: "In Progress" }));
    expect(await recordIdentityCheckResult(service, config, session)).toEqual({
      recorded: false,
      status: "In Progress",
    });
    vi.mocked(fetchDiditDecision).mockResolvedValue(decision({ vendor_data: "someone-else" }));
    expect(await recordIdentityCheckResult(service, config, session)).toEqual({
      recorded: false,
      status: "not_ours",
    });
    vi.mocked(fetchDiditDecision).mockResolvedValue(
      decision({ session_id: "88888888-8888-4888-8888-888888888888" })
    );
    await expect(recordIdentityCheckResult(service, config, session)).rejects.toThrow("changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers a repeated delivery without copying the photos again", async () => {
    vi.mocked(fetchDiditDecision).mockResolvedValue(decision());
    rpc.mockImplementation(async (name: string) =>
      name === "begin_identity_check_evidence"
        ? { data: null, error: { code: "PT409" } }
        : { data: { status: "approved", submission_id: idArtifact, reused: true }, error: null }
    );
    expect(await recordIdentityCheckResult(service, config, session)).toEqual({
      recorded: true,
      status: "approved",
    });
    expect(completion().p_outcome).toBe("not_finished");
    expect(fetchDiditImage).not.toHaveBeenCalled();
  });

  it("reports an unknown check as not recorded, and fails on anything else", async () => {
    vi.mocked(fetchDiditDecision).mockResolvedValue(decision({ status: "Expired" }));
    rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
    expect(await recordIdentityCheckResult(service, config, session)).toEqual({
      recorded: false,
      status: "unavailable",
    });
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(recordIdentityCheckResult(service, config, session)).rejects.toThrow();
  });
});
