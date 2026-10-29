/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { File } from "node:buffer";
import { randomBytes } from "node:crypto";
import { submitFoundationIdentity } from "./verification-runtime";
import { uploadToR2 } from "../services/storage";
vi.mock("../services/storage", () => ({
  uploadToR2: vi.fn(async (value) => ({ key: value.key })),
  getR2ObjectBytes: vi.fn(),
}));
vi.mock("../utils/image-reencode", () => ({
  isReencodableImageType: (type: string) => type === "image/png",
  reencodeImage: async (bytes: Buffer) => bytes,
}));
vi.mock("../utils/encryption", () => ({
  encryptData: async (bytes: Buffer) => bytes,
  decryptData: vi.fn(),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const api = { rpc: vi.fn() },
  service = { rpc: vi.fn() };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==",
  "base64"
);
const image = () => new File([png], "fixture.png", { type: "image/png" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HMAC_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("ID_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
  api.rpc.mockImplementation(async (name, args) => ({
    error: null,
    data:
      name === "open_verification_case"
        ? { case_id: id(1), version: 1, read_only: false }
        : { artifact_id: args.p_purpose === "id_front" ? id(2) : id(3) },
  }));
  service.rpc.mockImplementation(async (name, args) => ({
    error: null,
    data:
      name === "assess_identity_upload"
        ? { blocked: false, risk_score: 0 }
        : name === "evidence_upload_target"
          ? {
              artifact_id: args.p_artifact,
              case_id: id(1),
              object_key: `evidence/${id(1)}/${args.p_artifact === id(2) ? id(22) : id(33)}`,
              purpose: args.p_artifact === id(2) ? "id_front" : "selfie",
            }
          : name === "complete_evidence_upload"
            ? {
                artifact_id: args.p_artifact,
                state: "clean",
                case_version: args.p_artifact === id(2) ? 4 : 7,
              }
            : { submission_id: id(4), case_version: 8, reused: false },
  }));
});
afterEach(() => vi.unstubAllEnvs());
const submit = () =>
  submitFoundationIdentity(
    api as never,
    service as never,
    id(9),
    "8001015009087",
    image() as never,
    image() as never
  );
it("uses opaque journal keys and the revision returned by the last completed upload", async () => {
  await expect(submit()).resolves.toEqual({ submitted: true });
  expect(uploadToR2).toHaveBeenCalledTimes(2);
  expect(service.rpc).toHaveBeenCalledWith(
    "register_identity_submission",
    expect.objectContaining({
      p_expected_version: 7,
      p_id_artifact: id(2),
      p_selfie_artifact: id(3),
    })
  );
});
it("does not reread or retry registration to hide a concurrent revision change", async () => {
  const normal = service.rpc.getMockImplementation()!;
  service.rpc.mockImplementation((name, args) =>
    name === "register_identity_submission"
      ? Promise.resolve({ data: null, error: { code: "PT409" } })
      : normal(name, args)
  );
  await expect(submit()).rejects.toMatchObject({ status: 409 });
  expect(
    service.rpc.mock.calls.filter(([name]) => name === "register_identity_submission")
  ).toHaveLength(1);
  expect(api.rpc.mock.calls.filter(([name]) => name === "open_verification_case")).toHaveLength(1);
});
it("refuses an object key outside the authorised case before writing storage", async () => {
  const normal = service.rpc.getMockImplementation()!;
  service.rpc.mockImplementation(async (name, args) => {
    const result = await normal(name, args);
    if (name === "evidence_upload_target") result.data.object_key = `evidence/${id(99)}/${id(22)}`;
    return result;
  });
  await expect(submit()).rejects.toMatchObject({ status: 503 });
  expect(uploadToR2).not.toHaveBeenCalled();
});
