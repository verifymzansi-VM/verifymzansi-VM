/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET, POST } from "./route";
import { POST as POST_LEGAL_NAME } from "./legal-name/route";
import { POST as POST_AVATAR } from "./avatar/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-ip" }),
}));
const profile = {
  display_name: "Thando Dlamini",
  public_name: "Thando D.",
  bio: null,
  avatar_object_id: null,
  legal_first_name: null,
  legal_last_name: null,
  legal_name_locked: false,
  identity_verified: false,
  revision: 2,
  updated_at: "2026-10-21T10:00:00Z",
};
const token = "a".repeat(64);
const rpc = vi.fn(),
  authenticate = vi.fn();
function request(body?: unknown, { origin = "https://verifymzansi.com", csrf = true } = {}) {
  return new NextRequest(
    "https://verifymzansi.com/api/foundation/profile",
    body === undefined
      ? {}
      : {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
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
  rpc.mockResolvedValue({ data: profile, error: null });
  authenticate.mockResolvedValue({ rpc });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    respond: async (response: NextResponse) => {
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
});

it("reads only the verified caller's profile without shared caching", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(profile);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_profile");
});

it("saves a normalized display name and bio once", async () => {
  const response = await POST(
    request({ expected_revision: 2, display_name: " Thando Dlamini ", bio: " Hi " })
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("save_my_profile", {
    p_expected_revision: 2,
    p_display_name: "Thando Dlamini",
    p_bio: "Hi",
  });
});

it("refuses cross-origin, missing CSRF, invalid and oversized writes before any RPC", async () => {
  const body = { expected_revision: 2, display_name: "Thando" };
  expect((await POST(request(body, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await POST(request(body, { csrf: false }))).status).toBe(403);
  expect((await POST(request({ ...body, account_id: "x" }))).status).toBe(400);
  expect((await POST(request("{"))).status).toBe(400);
  expect((await POST(request({ ...body, bio: "x".repeat(5000) }))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("maps locked, conflict and reserved refusals without leaking database errors", async () => {
  for (const [code, details, status] of [
    ["PT409", "legal_name_locked", 409],
    ["PT409", "profile_changed", 409],
    ["22023", "display_name_reserved", 400],
    ["XX000", "internal detail", 503],
  ] as const) {
    rpc.mockResolvedValueOnce({ data: null, error: { code, details, message: "secret" } });
    const response = await POST(request({ expected_revision: 2, display_name: "Thando" }));
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  }
});

it("requires a verified foundation session and fails closed when Auth is unavailable", async () => {
  authenticate.mockRejectedValueOnce(new FoundationSessionError(401));
  expect((await GET(request())).status).toBe(401);
  authenticate.mockRejectedValueOnce(new FoundationSessionError(503));
  expect((await GET(request())).status).toBe(503);
  vi.mocked(readFoundationRuntimeConnection).mockImplementationOnce(() => {
    throw new Error("Unapproved foundation runtime project");
  });
  expect((await GET(request())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it("enforces rate limits, blocking when the limiter is degraded", async () => {
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, retryAfter: 9 });
  const limited = await GET(request());
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("9");
  vi.mocked(checkRateLimit).mockResolvedValueOnce({ limited: true, degraded: true });
  expect((await GET(request())).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});

it("routes legal-name claims and avatar links to their own commands", async () => {
  await POST_LEGAL_NAME(
    request({ expected_revision: 2, first_name: "Thando", last_name: "Dlamini" })
  );
  expect(rpc).toHaveBeenLastCalledWith("save_my_legal_name", {
    p_expected_revision: 2,
    p_first_name: "Thando",
    p_last_name: "Dlamini",
  });
  await POST_AVATAR(request({ expected_revision: 3, object_id: null }));
  expect(rpc).toHaveBeenLastCalledWith("set_my_avatar", { p_expected_revision: 3 });
  expect(vi.mocked(checkRateLimit).mock.calls.map(([options]) => options.action)).toEqual([
    "profile:update",
    "profile:avatar",
  ]);
});
