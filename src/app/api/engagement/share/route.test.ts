import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), cookie: vi.fn(), rpc: vi.fn(), row: vi.fn() }));
vi.mock("@/lib/engagement-route", () => ({
  prepareEngagementMutation: mocks.prepare,
  setEngagementViewerCookie: mocks.cookie,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        maybeSingle: mocks.row,
      };
      return query;
    },
  }),
}));
vi.mock("@/lib/analytics/traffic-quality", () => ({
  hashAnalyticsKey: () => "hashed-viewer",
  isAutomatedUserAgent: () => false,
}));
import { POST } from "./route";

describe("record share route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue({
      success: true,
      data: { targetId: "post", targetType: "business", viewerKey: "private-identity" },
    });
    mocks.row.mockResolvedValue({ data: { id: "post" } });
    mocks.rpc.mockResolvedValue({ data: [{ counted: true, share_count: 4 }], error: null });
  });
  const request = () =>
    new NextRequest("http://localhost/api/engagement/share", { method: "POST" });
  it("returns the server total and stores only a hashed viewer", async () => {
    const response = await POST(request());
    expect(await response.json()).toEqual({ counted: true, shareCount: 4 });
    expect(mocks.rpc).toHaveBeenCalledWith("record_content_share", {
      p_target_id: "post",
      p_target_type: "business",
      p_viewer_key: "hashed-viewer",
      p_viewer_user_id: null,
      p_anonymous_viewer_key: null,
    });
    expect(mocks.cookie).toHaveBeenCalled();
  });
  it("does not count unavailable/private posts", async () => {
    mocks.row.mockResolvedValue({ data: null });
    expect((await POST(request())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves origin/rate-limit rejection", async () => {
    mocks.prepare.mockResolvedValue({
      success: false,
      response: new Response(null, { status: 429 }),
    });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns unavailability rather than an invented zero when the database fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "missing" } });
    expect((await POST(request())).status).toBe(503);
  });
});
