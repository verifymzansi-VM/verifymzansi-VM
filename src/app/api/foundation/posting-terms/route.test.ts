/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET, POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { getPublishedPostingTerms } from "@/lib/legal/published-posting-terms";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));
const published = getPublishedPostingTerms("posting-v1")!;
const document = {
  version: published.version,
  document_hash: published.document_hash,
  document_path: `/terms/versions/${published.version}`,
  accepted_at: null,
};
const accepted = { ...document, accepted_at: "2026-10-21T08:00:00Z" };
const token = "a".repeat(64);
const rpc = vi.fn(),
  authenticate = vi.fn();
function request(body?: unknown, { origin = "https://verifymzansi.com", csrf = true } = {}) {
  return new NextRequest(
    "https://verifymzansi.com/api/foundation/posting-terms",
    body === undefined
      ? {}
      : {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            origin,
            ...(csrf ? { cookie: `vm_csrf=${token}`, "x-csrf-token": token } : {}),
          },
        }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationRuntimeConnection).mockReturnValue({
    url: "https://gntzjtuncsyefujajmjy.supabase.co",
    expectedProjectRef: "gntzjtuncsyefujajmjy",
    publishableKey: "sb_publishable_synthetic",
  });
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  rpc.mockImplementation(async (name) => ({
    data: name === "accept_posting_terms" ? accepted : document,
    error: null,
  }));
  authenticate.mockResolvedValue({ rpc });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    respond: async (response: NextResponse) => {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});
it("reads only the verified caller's current-version status with no shared caching", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(document);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_owner_posting_terms", {}, { get: false });
});
it("records explicit current-version acceptance and returns its exact receipt", async () => {
  const response = await POST(
    request({ version: document.version, document_hash: document.document_hash, accepted: true })
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(accepted);
  expect(rpc).toHaveBeenLastCalledWith(
    "accept_posting_terms",
    { p_version: document.version, p_document_hash: document.document_hash },
    { get: false }
  );
});
it.each([{ origin: "https://other.example" }, { csrf: false }])(
  "denies cross-site or CSRF-free writes before authenticating %#",
  async (options) => {
    expect((await POST(request({ accepted: true }, options))).status).toBe(403);
    expect(createFoundationRouteContext).not.toHaveBeenCalled();
  }
);
it.each([
  { accepted: false },
  {
    version: document.version,
    document_hash: document.document_hash,
    accepted: true,
    owner_id: "forged",
  },
  { padding: "x".repeat(5000) },
])("rejects invalid or oversized input before any acceptance write %#", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(rpc.mock.calls.every(([name]) => name === "get_owner_posting_terms")).toBe(true);
});
it.each([401, 503] as const)(
  "preserves authentication versus infrastructure failure status %s",
  async (status) => {
    authenticate.mockRejectedValueOnce(new FoundationSessionError(status));
    expect((await GET(request())).status).toBe(status);
    expect(rpc).not.toHaveBeenCalled();
  }
);
it("fails closed without configuration or with mismatched published content", async () => {
  vi.mocked(readFoundationRuntimeConnection).mockImplementationOnce(() => {
    throw new Error("private configuration");
  });
  expect((await GET(request())).status).toBe(503);
  expect(createFoundationRouteContext).not.toHaveBeenCalled();
  rpc.mockResolvedValueOnce({ data: { ...document, document_hash: "B".repeat(43) }, error: null });
  expect((await GET(request())).status).toBe(503);
});
it("fails closed when shared abuse protection is unavailable", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({
    limited: true,
    degraded: true,
    retryAfter: 60,
  });
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(authenticate).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("throttles repeated invalid sessions before contacting Auth", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 10 });
  const response = await GET(request());
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("10");
  expect(authenticate).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
