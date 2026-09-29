import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, resolveGeo, rateCheck, featureEnabled } = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveGeo: vi.fn(),
  rateCheck: vi.fn(),
  featureEnabled: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({ checkLocalRateLimit: rateCheck }));
vi.mock("@/lib/services/feature-flags", () => ({ isFeatureEnabled: featureEnabled }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser } })),
}));
vi.mock("@/lib/services/ip-geolocation", () => ({ resolveIpGeolocation: resolveGeo }));
import { POST } from "./route";

function request(withCsrf = true) {
  const token = "a".repeat(64);
  return new NextRequest("http://localhost/api/verification/location/detect", {
    method: "POST",
    headers: withCsrf ? { cookie: `vm_csrf=${token}`, "x-csrf-token": token } : {},
  });
}

describe("location detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateCheck.mockReturnValue({ limited: false });
    featureEnabled.mockResolvedValue(true);
    getUser.mockResolvedValue({
      data: { user: { id: "u1", email_confirmed_at: "2026-09-01" } },
      error: null,
    });
  });

  it("has a separate per-user detection cap with retry guidance", async () => {
    rateCheck.mockReturnValue({ limited: true, retryAfter: 30 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(rateCheck).toHaveBeenCalledWith("u1", "verification:location-detect", 10);
    expect(resolveGeo).not.toHaveBeenCalled();
  });

  it("honors the same flow flag as manual submission", async () => {
    featureEnabled.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(404);
    expect(resolveGeo).not.toHaveBeenCalled();
  });

  it("normalizes a known SA province/city without caching personal location", async () => {
    resolveGeo.mockResolvedValue({ country: "ZA", province: "Eastern Cape", city: "Gqeberha" });
    const response = await POST(request());
    expect(await response.json()).toEqual({
      detected: true,
      province: "Eastern Cape",
      city: "Port Elizabeth (Gqeberha)",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each([
    null,
    { country: "US", province: "Gauteng", city: "Johannesburg" },
    { country: "ZA", province: "Gauteng", city: "Cape Town" },
    { country: "ZA", province: "Gauteng", city: null },
  ])("falls back when both valid location fields are unavailable: %j", async (geo) => {
    resolveGeo.mockResolvedValue(geo);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ detected: false, city: null });
  });

  it("falls back on provider exceptions", async () => {
    resolveGeo.mockRejectedValue(new Error("unavailable"));
    expect(await (await POST(request())).json()).toMatchObject({ detected: false });
  });

  it("requires authentication", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(resolveGeo).not.toHaveBeenCalled();
  });

  it("requires confirmed email", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    expect((await POST(request())).status).toBe(403);
    expect(resolveGeo).not.toHaveBeenCalled();
  });

  it("requires CSRF protection", async () => {
    expect((await POST(request(false))).status).toBe(403);
    expect(resolveGeo).not.toHaveBeenCalled();
  });
});
