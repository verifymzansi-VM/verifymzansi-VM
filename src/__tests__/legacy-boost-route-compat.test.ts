import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postBusinessBoost } from "@/app/api/businesses/[id]/boost/route";

vi.mock("@/app/api/businesses/[id]/boost/route", () => ({
  POST: vi.fn(),
}));

describe("legacy boost route compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards storefront boost requests to the unified business handler", async () => {
    vi.mocked(postBusinessBoost).mockResolvedValue(new Response(null, { status: 401 }) as never);
    const { POST } = await import("@/app/api/storefronts/[id]/boost/route");

    const request = new Request("http://localhost/api/storefronts/test-id/boost", {
      method: "POST",
    });
    const context = { params: Promise.resolve({ id: "test-id" }) };

    const response = await POST(request as never, context);

    expect(postBusinessBoost).toHaveBeenCalledWith(request, context);
    expect(response.status).toBe(401);
  });

  it("forwards business-ads boost requests to the unified business handler", async () => {
    vi.mocked(postBusinessBoost).mockResolvedValue(new Response(null, { status: 403 }) as never);
    const { POST } = await import("@/app/api/business-ads/[id]/boost/route");

    const request = new Request("http://localhost/api/business-ads/test-id/boost", {
      method: "POST",
    });
    const context = { params: Promise.resolve({ id: "test-id" }) };

    const response = await POST(request as never, context);

    expect(postBusinessBoost).toHaveBeenCalledWith(request, context);
    expect(response.status).toBe(403);
  });
});
