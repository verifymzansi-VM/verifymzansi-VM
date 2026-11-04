/** @vitest-environment node */
import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import { checkRateLimit } from "@/lib/utils/rate-limit";
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/account-context", () => ({ readFoundationAccountContext: vi.fn() }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture" }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  key = "media/22222222-2222-4222-8222-222222222222",
  rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_MEDIA_URL", "https://media.verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => ({ rpc }),
    respond: async (res: NextResponse) => {
      res.headers.set("Cache-Control", "private, no-store");
      return res;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(readFoundationAccountContext).mockResolvedValue({
    profile: { avatar_object_id: id },
  } as Awaited<ReturnType<typeof readFoundationAccountContext>>);
  rpc.mockResolvedValue({
    data: [{ object_id: id, object_key: key, kind: "image", state: "ready" }],
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());
it("redirects the current owner's avatar ID to its actual independent public key without caching the private lookup", async () => {
  const response = await GET(new NextRequest(`https://verifymzansi.com/api/profile/avatar/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(`https://media.verifymzansi.com/${key}`);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(rpc).toHaveBeenCalledWith("resolve_my_frontend_media", { p_ids: [id] }, { get: false });
});
it("does not resolve another avatar or reveal a key without an authenticated owner session", async () => {
  expect(
    (
      await GET(new NextRequest("https://verifymzansi.com/api/profile/avatar/other"), {
        params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }),
      })
    ).status
  ).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate: async () => {
      throw new Error("expired");
    },
    respond: async (r: NextResponse) => r,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  expect(
    (
      await GET(new NextRequest(`https://verifymzansi.com/api/profile/avatar/${id}`), {
        params: Promise.resolve({ id }),
      })
    ).status
  ).toBe(404);
});
