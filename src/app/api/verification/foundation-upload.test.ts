/** @vitest-environment node */
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./upload/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { putImmutableR2Bytes } from "@/lib/services/storage";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { cleanEvidence } from "@/lib/foundation/verification-runtime";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("@/lib/services/storage", () => ({ putImmutableR2Bytes: vi.fn() }));
vi.mock("@/lib/foundation/verification-runtime", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  cleanEvidence: vi.fn(),
}));
vi.mock("@/lib/utils/encryption", () => ({
  encryptData: vi.fn(async (b) => b),
  decryptData: vi.fn(async (b) => b),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture-ip" }),
}));
const owner = "11111111-1111-4111-8111-111111111111",
  artifact = "22222222-2222-4222-8222-222222222222",
  caseId = "33333333-3333-4333-8333-333333333333",
  receipt = "44444444-4444-4444-8444-444444444444",
  csrf = "c".repeat(64),
  rpc = vi.fn(),
  serviceRpc = vi.fn();
const purpose = () => (selfie ? "selfie" : "id_front");
let selfie = false,
  completed = false;
function request(extra: Record<string, string> = {}, origin = "https://verifymzansi.com") {
  const form = new FormData();
  form.append("file", new File(["fixture-document"], "fixture.png", { type: "image/png" }));
  const fields = {
    docType: selfie ? "selfie" : "id_document",
    uploadRequestId: receipt,
    ...(!selfie
      ? {
          idNumber: "8001015009087",
          firstName: "Fixture",
          lastName: "Owner",
          idDocumentType: "sa_id",
        }
      : {}),
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest("https://verifymzansi.com/api/verification/upload", {
    method: "POST",
    headers: { origin, "x-csrf-token": csrf, cookie: `vm_csrf=${csrf}` },
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  selfie = false;
  completed = false;
  vi.stubEnv("NEXT_PUBLIC_DATA_BACKEND", "foundation");
  vi.stubEnv("HMAC_SECRET", "0123456789abcdef".repeat(4));
  vi.stubEnv("ID_ENCRYPTION_KEY", "fedcba9876543210".repeat(4));
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
  vi.mocked(cleanEvidence).mockResolvedValue(Buffer.from("clean-fixture"));
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_b, _k, bytes) => bytes);
  rpc.mockImplementation(async () => ({
    data: { artifact_id: artifact, completed: false },
    error: null,
  }));
  serviceRpc.mockImplementation(async (name: string) => ({
    data:
      name === "frontend_verification_upload_context"
        ? completed
          ? { completed: true, artifact_id: artifact, purpose: purpose() }
          : {
              completed: false,
              artifact_id: artifact,
              purpose: purpose(),
              case_id: caseId,
              object_key: `evidence/${caseId}/${artifact}`,
              fingerprint: "a".repeat(42) + "A",
              document_sha256: "d".repeat(64),
            }
        : name === "assess_identity_upload"
          ? { blocked: false, risk_score: 10 }
          : { completed: true, artifact_id: artifact, purpose: purpose() },
    error: null,
  }));
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => ({ api: { rpc }, accountId: owner }),
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(createFoundationServiceApi).mockReturnValue({
    rpc: serviceRpc,
  } as unknown as ReturnType<typeof createFoundationServiceApi>);
});
afterEach(() => vi.unstubAllEnvs());
it("binds ID receipt to authenticated owner, encrypted number and actual stored hashes", async () => {
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, artifactId: artifact, stepType: "id_doc" });
  expect(rpc).toHaveBeenCalledWith(
    "reserve_frontend_verification_upload",
    expect.objectContaining({
      p_request: receipt,
      p_purpose: "id_front",
      p_first_name: "Fixture",
      p_last_name: "Owner",
      p_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  );
  const completedArgs = serviceRpc.mock.calls.find(
    (c) => c[0] === "complete_frontend_verification_upload"
  )![1];
  expect(completedArgs.p_owner).toBe(owner);
  expect(JSON.stringify(completedArgs)).not.toContain("8001015009087");
  expect(completedArgs.p_identity.encrypted_number.key_id).toBe("identity-number-v1");
});
it("resolves a prior completion without another object write or identity registration", async () => {
  completed = true;
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  expect(serviceRpc).toHaveBeenCalledTimes(1);
});
it("uses native pair fraud assessment for selfie and never trusts the liveness hint", async () => {
  selfie = true;
  const res = await POST(request({ captureMethod: "camera", livenessPassed: "true" }));
  expect(res.status).toBe(200);
  expect(serviceRpc).toHaveBeenCalledWith("assess_identity_upload", {
    p_owner: owner,
    p_fingerprint: "a".repeat(42) + "A",
    p_document_sha256: "d".repeat(64),
    p_selfie_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(
    serviceRpc.mock.calls.find((c) => c[0] === "complete_frontend_verification_upload")![1]
  ).toMatchObject({ p_risk_score: 10 });
});
it("records how the browser says the selfie was taken, for staff review only", async () => {
  selfie = true;
  const recorded = () => rpc.mock.calls.filter((c) => c[0] === "record_my_selfie_capture");
  const cases: [Record<string, string>, Record<string, unknown>][] = [
    [
      { captureMethod: "camera", livenessPassed: "true" },
      { p_capture_method: "camera", p_browser_liveness_passed: true },
    ],
    [{ captureMethod: "camera" }, { p_capture_method: "camera", p_browser_liveness_passed: false }],
    [
      { captureMethod: "camera", livenessPassed: "false" },
      { p_capture_method: "camera", p_browser_liveness_passed: false },
    ],
    [
      { captureMethod: "file_upload" },
      { p_capture_method: "file_upload", p_browser_liveness_passed: false },
    ],
  ];
  for (const [fields, expected] of cases) {
    rpc.mockClear();
    serviceRpc.mockClear();
    expect((await POST(request(fields))).status).toBe(200);
    // With the member's own session, for this upload request, before completion.
    expect(recorded()).toEqual([["record_my_selfie_capture", { p_request: receipt, ...expected }]]);
    const order =
      rpc.mock.invocationCallOrder[
        rpc.mock.calls.findIndex((c) => c[0] === "record_my_selfie_capture")
      ];
    const completion = serviceRpc.mock.calls.findIndex(
      (c) => c[0] === "complete_frontend_verification_upload"
    );
    expect(order).toBeLessThan(serviceRpc.mock.invocationCallOrder[completion]);
    // The risk score still comes from the server's own assessment only.
    expect(serviceRpc.mock.calls[completion][1]).toEqual(
      expect.not.objectContaining({ p_capture_method: expect.anything() })
    );
    expect(serviceRpc.mock.calls[completion][1]).toMatchObject({ p_risk_score: 10 });
  }
  // Nothing reported: nothing recorded (the viewer says "Liveness unknown").
  rpc.mockClear();
  expect((await POST(request())).status).toBe(200);
  expect(recorded()).toEqual([]);
});
it("refuses the upload when the report cannot be recorded, before storing evidence", async () => {
  selfie = true;
  rpc.mockImplementation(async (name: string) =>
    name === "record_my_selfie_capture"
      ? { data: null, error: { code: "PT409" } }
      : { data: { artifact_id: artifact, completed: false }, error: null }
  );
  expect((await POST(request({ captureMethod: "camera" }))).status).toBe(409);
  expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  expect(serviceRpc.mock.calls.some((c) => c[0] === "complete_frontend_verification_upload")).toBe(
    false
  );
});
it("rejects a capture report outside the closed set before reserving or storing evidence", async () => {
  selfie = true;
  const refused: Record<string, string>[] = [
    { captureMethod: "screen" },
    { captureMethod: "file_upload", livenessPassed: "true" },
    { captureMethod: "camera", livenessPassed: "yes" },
    { livenessPassed: "true" },
  ];
  for (const fields of refused) {
    const res = await POST(request(fields));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Retake your selfie and try again" });
  }
  expect(rpc).not.toHaveBeenCalled();
  expect(putImmutableR2Bytes).not.toHaveBeenCalled();
});
it("never records a capture report for the ID document", async () => {
  expect((await POST(request({ captureMethod: "file_upload" }))).status).toBe(200);
  expect(rpc.mock.calls.some((c) => c[0] === "record_my_selfie_capture")).toBe(false);
});
it("rejects cross-origin writes and forged owner fields before reserving or storing evidence", async () => {
  expect((await POST(request({}, "https://untrusted.example"))).status).toBe(403);
  expect((await POST(request({ owner_id: artifact }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect(putImmutableR2Bytes).not.toHaveBeenCalled();
});
it("rejects mismatched stored bytes and case conflicts without retrying a native mutation", async () => {
  vi.mocked(putImmutableR2Bytes).mockResolvedValue(Buffer.from("other"));
  expect((await POST(request())).status).toBe(503);
  expect(serviceRpc.mock.calls.some((c) => c[0] === "complete_frontend_verification_upload")).toBe(
    false
  );
  rpc.mockResolvedValue({ data: null, error: { code: "PT409" } });
  expect((await POST(request())).status).toBe(409);
});
