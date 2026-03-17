import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockLogAuditEvent,
  mockCheckLocalRateLimit,
  mockSendDsarCompletedEmail,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockSendDsarCompletedEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/services/email", () => ({
  sendDsarCompletedEmail: mockSendDsarCompletedEmail,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
}));

vi.mock("@/lib/auth/roles", () => ({
  isAdmin: () => true,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: () => null,
}));

import { POST } from "./route";

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as Request;
}

describe("POST /api/admin/dsar/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
        }),
      },
    });
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockLogAuditEvent.mockResolvedValue(undefined);
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: "case-1", requester_email: "requester@example.com" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
  });

  it("logs dsar_completed when an admin completes a request", async () => {
    const requestId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

    const response = await POST(
      createMockRequest({
        requestId,
        notes: "Export package delivered securely",
      })
    );

    expect(response.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "dsar_completed",
        targetId: requestId,
      })
    );
    expect(mockSendDsarCompletedEmail).toHaveBeenCalledWith(
      "requester@example.com",
      expect.stringContaining("DSAR-"),
      "Export package delivered securely"
    );
  });
});
