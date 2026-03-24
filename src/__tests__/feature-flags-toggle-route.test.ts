import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as ApiModule from "@/lib/utils/api";

const {
  mockGetUser,
  mockToggle,
  mockUpdateConfig,
  mockAudit,
  mockVerifyAdminActorRoleFromDb,
  mockParseJson,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockToggle: vi.fn(),
  mockUpdateConfig: vi.fn(),
  mockAudit: vi.fn(),
  mockVerifyAdminActorRoleFromDb: vi.fn(),
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

vi.mock("@/lib/auth/admin-access", () => ({
  verifyAdminActorRoleFromDb: mockVerifyAdminActorRoleFromDb,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn(() => null),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual<typeof ApiModule>("@/lib/utils/api");
  return {
    ...actual,
    parseJsonRequest: mockParseJson,
    parseAndValidateJsonRequest: vi.fn(async (req: { json: () => Promise<unknown> }) => {
      const body = await mockParseJson(req);
      if (body === null) {
        return {
          success: false,
          response: Response.json({ error: "Invalid JSON payload" }, { status: 400 }),
        };
      }
      return { success: true, data: body };
    }),
  };
});

import { POST } from "@/app/api/admin/feature-flags/toggle/route";
import type { NextRequest } from "next/server";

function makeRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
    url: "http://localhost:3000/api/admin/feature-flags/toggle",
    headers: { get: () => null },
    nextUrl: new URL("http://localhost:3000/api/admin/feature-flags/toggle"),
  } as unknown as NextRequest;
}

describe("POST /api/admin/feature-flags/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
  });

  it("should return 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(makeRequest({ key: "test", enabled: true }));
    expect(res.status).toBe(401);
  });

  it("should reject cross-site requests", async () => {
    const req = {
      ...makeRequest({ key: "test", enabled: true }),
      headers: { get: (name: string) => (name === "origin" ? "https://evil.example" : null) },
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("should return 403 for non-admin users", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1" } },
      error: null,
    });
    mockVerifyAdminActorRoleFromDb.mockResolvedValue(null);

    const res = await POST(makeRequest({ key: "test", enabled: true }));
    expect(res.status).toBe(403);
  });

  it("should toggle a legacy feature flag for admin", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@example.com" } },
      error: null,
    });
    mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
    mockParseJson.mockResolvedValue({ key: "dark_mode", enabled: true });
    mockToggle.mockResolvedValue({ success: true });
    mockAudit.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ key: "dark_mode", enabled: true }));
    expect(res.status).toBe(200);
    expect(mockToggle).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "admin", targetId: "dark_mode" })
    );
  });

  it("should handle canary mode update for admin", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "admin@example.com" } },
      error: null,
    });
    mockVerifyAdminActorRoleFromDb.mockResolvedValue("admin");
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
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "admin", targetId: "new_feature" })
    );
  });
});
