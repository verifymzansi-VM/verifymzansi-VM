import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockToggle, mockUpdateConfig, mockAudit, mockIsAdmin, mockParseJson } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockToggle: vi.fn(),
    mockUpdateConfig: vi.fn(),
    mockAudit: vi.fn(),
    mockIsAdmin: vi.fn(),
    mockParseJson: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/lib/services/feature-flags", () => ({
  toggleFeatureFlag: mockToggle,
  updateFeatureFlagConfig: mockUpdateConfig,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockAudit,
}));

vi.mock("@/lib/auth/roles", () => ({
  isAdmin: mockIsAdmin,
}));

vi.mock("@/lib/utils/api", () => ({
  parseJsonRequest: mockParseJson,
}));

import { POST } from "@/app/api/admin/feature-flags/toggle/route";
import type { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    headers: { get: () => null },
    nextUrl: new URL("http://localhost:3000/api/admin/feature-flags/toggle"),
  } as unknown as NextRequest;
}

describe("POST /api/admin/feature-flags/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeRequest({ key: "test", enabled: true }));
    expect(res.status).toBe(401);
  });

  it("should return 403 for non-admin users", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockIsAdmin.mockReturnValue(false);

    const res = await POST(makeRequest({ key: "test", enabled: true }));
    expect(res.status).toBe(403);
  });

  it("should toggle a legacy feature flag for admin", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@example.com" } },
      error: null,
    });
    mockIsAdmin.mockReturnValue(true);
    mockParseJson.mockResolvedValue({ key: "dark_mode", enabled: true });
    mockToggle.mockResolvedValue({ success: true });
    mockAudit.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ key: "dark_mode", enabled: true }));
    expect(res.status).toBe(200);
    expect(mockToggle).toHaveBeenCalled();
  });

  it("should handle canary mode update for admin", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@example.com" } },
      error: null,
    });
    mockIsAdmin.mockReturnValue(true);
    mockParseJson.mockResolvedValue({
      key: "new_feature",
      mode: "percent",
      percent: 50,
      reason: "gradual rollout",
    });
    mockUpdateConfig.mockResolvedValue({ success: true });
    mockAudit.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest({
        key: "new_feature",
        mode: "percent",
        percent: 50,
        reason: "gradual rollout",
      })
    );
    expect(res.status).toBe(200);
    expect(mockUpdateConfig).toHaveBeenCalled();
  });
});
