/** @vitest-environment node */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { POST } from "./route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { FoundationMediaError, uploadFoundationMedia } from "@/lib/foundation/media-upload";
import { setFoundationAvatar, FoundationProfileError } from "@/lib/foundation/account-profile";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({}),
}));
vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: () => service }));
vi.mock("@/lib/foundation/media-upload", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  uploadFoundationMedia: vi.fn(),
}));
vi.mock("@/lib/foundation/account-profile", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  setFoundationAvatar: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "fixture-ip" }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
const api = {};
const service = {};
const authenticateCaller = vi.fn();
const csrf = "c".repeat(64);
const object = "aaaaaaaa-aaaa-4aaa-8aaa-111111111111";
function request({ revision = "3", csrfValid = true, size = 10, extra = false } = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(size)], "avatar.png", { type: "image/png" }));
  form.append("expectedRevision", revision);
  if (extra) form.append("owner_id", object);
  return new NextRequest("https://verifymzansi.com/api/profile/avatar", {
    method: "POST",
    body: form,
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      ...(csrfValid ? { "x-csrf-token": csrf } : {}),
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticateCaller.mockResolvedValue({ accountId: object, api });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller,
    respond: async (response: NextResponse) => {
      response.headers.set("cache-control", "private, no-store");
      return response;
    },
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(uploadFoundationMedia).mockResolvedValue({
    object_id: object,
    url: `https://media.verifymzansi.com/media/${object}`,
    kind: "image",
    width: 1,
    height: 1,
  });
  vi.mocked(setFoundationAvatar).mockResolvedValue({ revision: 4 } as Awaited<
    ReturnType<typeof setFoundationAvatar>
  >);
});
afterEach(() => vi.unstubAllEnvs());
it("uploads through the native media journal and links only the owned object at the submitted revision", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(uploadFoundationMedia).toHaveBeenCalledWith(api, service, expect.any(File));
  expect(setFoundationAvatar).toHaveBeenCalledWith(api, {
    expected_revision: 3,
    object_id: object,
  });
  expect(await response.json()).toMatchObject({ success: true, revision: 4 });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(vi.mocked(checkRateLimit).mock.calls.map(([options]) => options)).toEqual([
    { key: "fixture-ip", action: "profile:avatar", degradedMode: "block" },
    { key: object, action: "profile:avatar", degradedMode: "block" },
  ]);
});
it("keeps the previous avatar intact when a concurrent edit makes the revision stale", async () => {
  vi.mocked(setFoundationAvatar).mockRejectedValue(new FoundationProfileError("changed"));
  const response = await POST(request());
  expect(response.status).toBe(412);
  expect((await response.json()).error).toMatch(/Reload/);
  expect(createAdminClient).not.toHaveBeenCalled();
});
it("tells the member when photo uploads are paused for the month, keeping the old avatar", async () => {
  vi.mocked(uploadFoundationMedia).mockRejectedValue(
    new FoundationMediaError(503, "images_allowance_exhausted")
  );
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect((await response.json()).error).toBe(
    "Photo uploads are paused for now. Please try again later."
  );
  expect(setFoundationAvatar).not.toHaveBeenCalled();
});
it("refuses CSRF failures, invalid revisions, oversized files and caller-selected ownership before upload", async () => {
  expect((await POST(request({ csrfValid: false }))).status).toBe(403);
  for (const input of [
    { revision: "" },
    { revision: "1e3" },
    { size: 2 * 1024 * 1024 + 1 },
    { extra: true },
  ])
    expect((await POST(request(input))).status).toBe(400);
  expect(uploadFoundationMedia).not.toHaveBeenCalled();
});
it("requires a live caller and fail-closed shared protection", async () => {
  authenticateCaller.mockRejectedValue(new FoundationSessionError(401));
  expect((await POST(request())).status).toBe(401);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, degraded: true });
  expect((await POST(request())).status).toBe(503);
  expect(uploadFoundationMedia).not.toHaveBeenCalled();
});
