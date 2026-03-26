import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockVerifyCapabilityFromDb,
  mockResolveAppeal,
  mockEnforceSameOriginMutation,
  mockEnforceCsrfToken,
  mockCheckLocalRateLimit,
  mockLogApiError,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockVerifyCapabilityFromDb: vi.fn(),
  mockResolveAppeal: vi.fn(),
  mockEnforceSameOriginMutation: vi.fn(),
  mockEnforceCsrfToken: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockLogApiError: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyCapabilityFromDb: mockVerifyCapabilityFromDb,
}));

vi.mock("@/lib/services/decision-ledger", () => ({
  resolveAppeal: mockResolveAppeal,
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: mockEnforceSameOriginMutation,
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: mockEnforceCsrfToken,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/roles", () => ({
  getRoleFromUser: vi.fn(() => "governance_controller"),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/api", async () => {
  const actual = await vi.importActual("@/lib/utils/api");
  return {
    ...actual,
    logApiError: mockLogApiError,
  };
});

import { POST } from "@/app/api/admin/governance/appeal/route";

function createRequest(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost:3000/api/admin/governance/appeal", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/governance/appeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceSameOriginMutation.mockReturnValue(null);
    mockEnforceCsrfToken.mockReturnValue(null);
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockVerifyCapabilityFromDb.mockResolvedValue(true);
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "gov-1", app_metadata: { role: "governance_controller" } } },
        }),
      },
    });
  });

  it("returns 403 when capability verification fails", async () => {
    mockVerifyCapabilityFromDb.mockResolvedValue(false);

    const res = await POST(
      createRequest({
        appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        status: "upheld",
        rationale: "Reviewed",
      })
    );

    expect(res.status).toBe(403);
  });

  it("returns 429 when locally rate limited", async () => {
    mockCheckLocalRateLimit.mockReturnValue({ limited: true, retryAfter: 30 });

    const res = await POST(
      createRequest({
        appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        status: "upheld",
        rationale: "Reviewed",
      })
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("resolves an appeal", async () => {
    mockResolveAppeal.mockResolvedValue({
      appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "overturned",
    });

    const res = await POST(
      createRequest({
        appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        status: "overturned",
        rationale: "New evidence accepted",
        outcomeDetail: { newAction: "warning" },
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "overturned" });
    expect(mockResolveAppeal).toHaveBeenCalledWith(
      expect.objectContaining({
        appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        reviewerId: "gov-1",
        reviewerRole: "governance_controller",
        status: "overturned",
        rationale: "New evidence accepted",
        outcomeDetail: { newAction: "warning" },
      })
    );
  });

  it("returns 500 when the service throws unexpectedly", async () => {
    mockResolveAppeal.mockRejectedValue(new Error("db offline"));

    const res = await POST(
      createRequest({
        appealId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        status: "dismissed",
        rationale: "No change",
      })
    );

    expect(res.status).toBe(500);
    expect(mockLogApiError).toHaveBeenCalled();
  });
});
