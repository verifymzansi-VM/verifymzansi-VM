/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET as directory } from "./route";
import { GET as badges } from "./badges/route";
import { POST as preview } from "./invites/preview/route";
import { POST as accept } from "./invites/accept/route";
import { POST as apply } from "./applications/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { createFoundationPublicApi } from "@/lib/foundation/public-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/public-api", () => ({ createFoundationPublicApi: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));
const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const csrf = "a".repeat(64);
const token = "A".repeat(43);
const publicRpc = vi.fn(),
  rpc = vi.fn();
function request(path: string, body?: unknown, { origin = "https://verifymzansi.com" } = {}) {
  return new NextRequest(
    "https://verifymzansi.com/api/foundation/organisations" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            origin,
            cookie: `vm_csrf=${csrf}`,
            "x-csrf-token": csrf,
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
  vi.mocked(createFoundationPublicApi).mockReturnValue({ rpc: publicRpc } as never);
  publicRpc.mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValue({ data: { id, status: "submitted" }, error: null });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (response: NextResponse) => response,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});

it("serves the public directory briefly cacheable and fails closed", async () => {
  const ok = await directory(request(""));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("Cache-Control")).toContain("max-age=60");
  publicRpc.mockResolvedValueOnce({ data: [{ unexpected: true }], error: null });
  const bad = await directory(request(""));
  expect(bad.status).toBe(503);
  expect(bad.headers.get("Cache-Control")).toContain("no-store");
});

it("bounds badge lookups and rate limits public reads", async () => {
  expect((await badges(request("/badges?ids=" + Array(101).fill(id).join(",")))).status).toBe(400);
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 5 });
  expect((await badges(request("/badges?ids=" + id))).status).toBe(429);
  expect(publicRpc).not.toHaveBeenCalled();
});

it("previews an invitation by POST with only the token hash sent and no caching", async () => {
  publicRpc.mockResolvedValueOnce({ data: null, error: null });
  const response = await preview(request("/invites/preview", { token }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const [, args] = publicRpc.mock.calls[0];
  expect(args.p_token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(publicRpc.mock.calls)).not.toContain(token);
  expect(
    (await preview(request("/invites/preview", { token }, { origin: "https://evil.example" })))
      .status
  ).toBe(403);
});

it("accepts invitations and applications only with origin and CSRF, never trusting identity fields", async () => {
  expect(
    (await accept(request("/invites/accept", { token }, { origin: "https://evil.example" }))).status
  ).toBe(403);
  const body = { organisation_id: id, post_id: id, share_representative_name: true, consent: true };
  expect((await apply(request("/applications", body))).status).toBe(200);
  expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_applicant");
  expect((await apply(request("/applications", { ...body, applicant_id: id }))).status).toBe(400);
  expect((await apply(request("/applications", { ...body, consent: false }))).status).toBe(400);
  expect(rpc).toHaveBeenCalledTimes(1);
});
