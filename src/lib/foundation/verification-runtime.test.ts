/** @vitest-environment node */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { readStaffIdentityContext } from "./staff-identity";
import { getR2ObjectBytes } from "../services/storage";
import { decryptData } from "../utils/encryption";
import { readFoundationEvidenceBytes, readFoundationReviewContext } from "./verification-runtime";
vi.mock("server-only", () => ({}));
vi.mock("./staff-identity", () => ({ readStaffIdentityContext: vi.fn() }));
vi.mock("../services/storage", () => ({ uploadToR2: vi.fn(), getR2ObjectBytes: vi.fn() }));
vi.mock("../utils/encryption", () => ({ encryptData: vi.fn(), decryptData: vi.fn() }));
const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const input = { case_id: id("1"), claim_generation: "4", claim_nonce: id("2") };
const context = {
  case_id: input.case_id,
  case_version: 3,
  submission_id: id("3"),
  risk_score: 0,
  recipe: "manual-id-selfie-v1" as const,
  id_artifact_id: id("4"),
  selfie_artifact_id: id("5"),
};
const stored = Buffer.from("synthetic encrypted evidence");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const rpc = vi.fn(),
  machine = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;
const service = { rpc: machine } as unknown as FoundationServiceApi;
let artifact: Record<string, unknown>;
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  const key = randomBytes(32),
    iv = randomBytes(12);
  vi.stubEnv("ID_ENCRYPTION_KEY", key.toString("hex"));
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update("0000000000000"), cipher.final()]);
  artifact = {
    artifact_id: context.id_artifact_id,
    object_key: `evidence/${input.case_id}/${context.id_artifact_id}`,
    sha256: createHash("sha256").update(stored).digest("hex"),
    size_bytes: stored.length,
    encrypted_number: {
      ciphertext: ciphertext.toString("hex"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      key_id: "identity-number-v1",
    },
    claimed_names: { first_name: "Synthetic", last_name: "Member" },
  };
  vi.mocked(readStaffIdentityContext).mockResolvedValue(context);
  rpc.mockResolvedValue({
    data: { artifacts: [{ id: context.id_artifact_id }, { id: context.selfie_artifact_id }] },
    error: null,
  });
  machine.mockImplementation(async () => ({ data: artifact, error: null }));
  vi.mocked(getR2ObjectBytes).mockResolvedValue({ bytes: stored });
  vi.mocked(decryptData).mockResolvedValue(png);
});
it("returns number and submitted names only through current claims and repeated audited authority", async () => {
  const result = await readFoundationReviewContext(api, service, input);
  expect(result.claimed_number).toBe("0000000000000");
  expect(result.claimed_names).toEqual({ first_name: "Synthetic", last_name: "Member" });
  expect(readStaffIdentityContext).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls.every(([name]) => name === "staff_evidence_metadata")).toBe(true);
});
it("refuses number access before machine lookup if audited staff authority is revoked", async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(readFoundationReviewContext(api, service, input)).rejects.toMatchObject({
    status: 403,
  });
  expect(machine).not.toHaveBeenCalled();
});
it("does not return a number after its submission version changes during the read", async () => {
  vi.mocked(readStaffIdentityContext)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce({ ...context, case_version: 4 });
  await expect(readFoundationReviewContext(api, service, input)).rejects.toMatchObject({
    status: 409,
  });
});
it("checks ciphertext hash, decrypts the bytes and rechecks current authority before release", async () => {
  const result = await readFoundationEvidenceBytes(api, service, input, context.id_artifact_id);
  expect(result.mime).toBe("image/png");
  expect(Buffer.from(result.bytes)).toEqual(png);
  expect(readStaffIdentityContext).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenCalledWith(
    "staff_evidence_metadata",
    expect.objectContaining({
      p_case_id: input.case_id,
      p_claim_generation: "4",
      p_claim_nonce: input.claim_nonce,
    })
  );
});
it.each(["wrong object", "changed bytes", "revoked claim", "changed submission"])(
  "denies evidence bytes on %s",
  async (change) => {
    if (change === "wrong object")
      artifact.object_key = `evidence/${id("9")}/${context.id_artifact_id}`;
    if (change === "changed bytes")
      vi.mocked(getR2ObjectBytes).mockResolvedValueOnce({ bytes: Buffer.from("changed") });
    if (change === "revoked claim")
      rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    if (change === "changed submission")
      vi.mocked(readStaffIdentityContext)
        .mockResolvedValueOnce(context)
        .mockResolvedValueOnce({ ...context, submission_id: id("9") });
    await expect(
      readFoundationEvidenceBytes(api, service, input, context.id_artifact_id)
    ).rejects.toThrow();
    if (["wrong object", "changed bytes"].includes(change))
      expect(decryptData).not.toHaveBeenCalled();
  }
);
it("refuses a caller-selected artifact outside the current reviewed submission", async () => {
  await expect(readFoundationEvidenceBytes(api, service, input, id("9"))).rejects.toMatchObject({
    status: 403,
  });
  expect(machine).not.toHaveBeenCalled();
  expect(getR2ObjectBytes).not.toHaveBeenCalled();
});
