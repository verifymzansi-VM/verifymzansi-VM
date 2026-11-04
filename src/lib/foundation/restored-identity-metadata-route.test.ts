/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleRestoredIdentityMetadata } from "./restored-identity-metadata-route";
import { createFoundationRouteContext } from "./request-route";
import { createFoundationServiceApi } from "./service-api";
import { readFoundationReviewContext } from "./verification-runtime";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./verification-runtime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFoundationReviewContext: vi.fn(),
}));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
  actor = id(9),
  owner = id(8),
  csrf = "c".repeat(64),
  rpc = vi.fn();
const context = {
  case_id: id(1),
  case_version: 7,
  submission_id: id(2),
  risk_score: 10,
  recipe: "manual-id-selfie-v1" as const,
  id_artifact_id: id(4),
  selfie_artifact_id: id(5),
};
const profile = {
  display_name: "Fixture Member",
  account_verification_status: "pending_review",
  account_status: "active",
  strikes: null,
  legal_hold: false,
  location_province: null,
  location_city: null,
};
function request(body: unknown) {
  return new NextRequest("https://verifymzansi.com/api/admin/verification/evidence/metadata", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(createFoundationServiceApi).mockReturnValue({ rpc: vi.fn() } as never);
  vi.mocked(readFoundationReviewContext).mockResolvedValue({
    ...context,
    claimed_names: { first_name: "Fixture", last_name: "Member" },
    claimed_number: "8001015009087",
  });
  rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "get_frontend_staff_identity_context"
        ? {
            ...context,
            reviewer_id: actor,
            owner_id: owner,
            claim_generation: "4",
            claim_nonce: id(3),
            claim_expires_at: "2026-11-04T19:00:00Z",
            owner_profile: profile,
            access_log: [],
          }
        : {
            case_id: id(1),
            version: 7,
            artifacts: [
              {
                artifact_id: id(4),
                purpose: "id_front",
                size_bytes: 128,
                uploaded_at: "2026-11-04T10:00:00Z",
              },
              {
                artifact_id: id(5),
                purpose: "selfie",
                size_bytes: 128,
                uploaded_at: "2026-11-04T10:00:00Z",
              },
            ],
          },
  }));
});
afterEach(() => vi.unstubAllEnvs());
it("preserves the existing viewer metadata without inventing plaintext format, size or provider scores", async () => {
  const response = await handleRestoredIdentityMetadata(request({ userId: owner }));
  expect(response.status).toBe(200);
  expect(response.headers.get("X-VerifyMzansi-Actor")).toBe(actor);
  const body = await response.json();
  expect(body.artifacts).toHaveLength(2);
  expect(body.artifacts[0]).toMatchObject({
    id: id(4),
    step_type: "id_doc",
    r2_key: null,
    content_type: "application/octet-stream",
    file_size_bytes: null,
    foundation: {
      caseId: id(1),
      caseVersion: 7,
      submissionId: id(2),
      claimGeneration: "4",
      claimNonce: id(3),
    },
  });
  expect(body.providerResults).toEqual([]);
  expect(body.accountProfile).toEqual(profile);
  expect(readFoundationReviewContext).toHaveBeenCalledExactlyOnceWith({ rpc }, expect.anything(), {
    case_id: id(1),
    claim_generation: "4",
    claim_nonce: id(3),
    expected_case_version: 7,
    expected_submission_id: id(2),
  });
});
it("does not initialize private machine access when native staff authority is refused", async () => {
  rpc.mockResolvedValueOnce({
    data: null,
    error: { code: "42501", message: "recent second-factor verification required" },
  });
  const response = await handleRestoredIdentityMetadata(request({ userId: owner }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "step_up_required" });
  expect(createFoundationServiceApi).not.toHaveBeenCalled();
  expect(readFoundationReviewContext).not.toHaveBeenCalled();
});
it("refuses a different owner or changed case metadata without falling back to an old lookup", async () => {
  expect((await handleRestoredIdentityMetadata(request({ userId: id(77) }))).status).toBe(409);
  expect(readFoundationReviewContext).not.toHaveBeenCalled();
  rpc.mockClear();
  rpc
    .mockResolvedValueOnce({
      data: {
        ...context,
        reviewer_id: actor,
        owner_id: owner,
        claim_generation: "4",
        claim_nonce: id(3),
        claim_expires_at: "2026-11-04T19:00:00Z",
        owner_profile: profile,
        access_log: [],
      },
      error: null,
    })
    .mockResolvedValueOnce({ data: { case_id: id(1), version: 8, artifacts: [] }, error: null });
  expect((await handleRestoredIdentityMetadata(request({ userId: owner }))).status).toBe(409);
  expect(rpc).toHaveBeenCalledTimes(2);
});
