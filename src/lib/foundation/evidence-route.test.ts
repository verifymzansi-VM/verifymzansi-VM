/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleFoundationEvidenceRead } from "./evidence-route";
import { createFoundationRouteContext } from "./request-route";
import { readFoundationEvidenceBytes } from "./verification-runtime";
import { createFoundationServiceApi } from "./service-api";
import { checkRateLimit } from "../utils/rate-limit";
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: () => ({}) }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./verification-runtime", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFoundationEvidenceBytes: vi.fn(),
}));
vi.mock("../utils/rate-limit", () => ({ checkRateLimit: vi.fn() }));
const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
  actor = id(9),
  api = { rpc: vi.fn() },
  service = { rpc: vi.fn() },
  csrf = "c".repeat(64);
const scope = {
  caseId: id(1),
  caseVersion: 7,
  submissionId: id(2),
  claimGeneration: "4",
  claimNonce: id(3),
};
function request(body: unknown, valid = true) {
  return new NextRequest("https://verifymzansi.com/api/admin/verification/evidence", {
    method: "POST",
    headers: {
      origin: "https://verifymzansi.com",
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      ...(valid ? { "x-csrf-token": csrf } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: async () => ({ api, accountId: actor }),
    respond: (r: NextResponse) => {
      r.headers.set("Cache-Control", "private, no-store");
      return r;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationEvidenceBytes).mockResolvedValue({
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer,
    mime: "image/png",
  });
});
afterEach(() => vi.unstubAllEnvs());
it("serves inspected bytes with the current actor and the exact viewed submission fence", async () => {
  const response = await handleFoundationEvidenceRead(
    request({ artifactId: id(4), foundation: scope }),
    "restored"
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("X-VerifyMzansi-Actor")).toBe(actor);
  expect(readFoundationEvidenceBytes).toHaveBeenCalledExactlyOnceWith(
    api,
    service,
    {
      case_id: scope.caseId,
      claim_generation: "4",
      claim_nonce: scope.claimNonce,
      expected_case_version: 7,
      expected_submission_id: scope.submissionId,
    },
    id(4)
  );
});
it("refuses missing scope, forged storage keys and CSRF before any private object read", async () => {
  expect(
    (await handleFoundationEvidenceRead(request({ artifactId: id(4) }), "restored")).status
  ).toBe(400);
  expect(
    (
      await handleFoundationEvidenceRead(
        request({ artifactId: id(4), foundation: scope, object_key: "private/foreign" }),
        "restored"
      )
    ).status
  ).toBe(400);
  expect(
    (
      await handleFoundationEvidenceRead(
        request({ artifactId: id(4), foundation: scope }, false),
        "restored"
      )
    ).status
  ).toBe(403);
  expect(readFoundationEvidenceBytes).not.toHaveBeenCalled();
});
it("retains the selected native URL contract", async () => {
  expect(
    (
      await handleFoundationEvidenceRead(
        request({
          artifact_id: id(4),
          case_id: scope.caseId,
          claim_generation: "4",
          claim_nonce: scope.claimNonce,
        })
      )
    ).status
  ).toBe(200);
  expect(readFoundationEvidenceBytes).toHaveBeenCalledTimes(1);
});
it("rechecks PDF active content before returning a private stream", async () => {
  vi.mocked(readFoundationEvidenceBytes).mockResolvedValue({
    bytes: new TextEncoder().encode("%PDF-1.4\n/JavaScript /JS (app.alert('test'))").buffer,
    mime: "application/pdf",
  });
  expect(
    (
      await handleFoundationEvidenceRead(
        request({ artifactId: id(4), foundation: scope }),
        "restored"
      )
    ).status
  ).toBe(422);
});
