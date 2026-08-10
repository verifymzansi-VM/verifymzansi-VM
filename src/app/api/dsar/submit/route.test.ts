import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckLocalRateLimit,
  mockNotifyStaffForAdminEvent,
  mockSendDsarSubmissionEmail,
  mockLogAuditEvent,
  mockVerifyTurnstileToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckLocalRateLimit: vi.fn(),
  mockNotifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
  mockSendDsarSubmissionEmail: vi.fn().mockResolvedValue(undefined),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockVerifyTurnstileToken: vi.fn(),
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
  sendDsarSubmissionEmail: mockSendDsarSubmissionEmail,
}));

vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkLocalRateLimit: mockCheckLocalRateLimit,
  getClientIp: vi.fn().mockReturnValue("203.0.113.10"),
}));

vi.mock("@/lib/utils/mutation-origin", () => ({
  enforceSameOriginMutation: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/utils/csrf", () => ({
  enforceCsrfToken: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/notifications", () => ({
  notifyStaffForAdminEvent: mockNotifyStaffForAdminEvent,
}));

import { POST } from "./route";

function createRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("POST /api/dsar/submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckLocalRateLimit.mockReturnValue({ limited: false });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: "member-1",
              email_confirmed_at: "2026-04-14T10:00:00.000Z",
            },
          },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: "case-12345678" },
              error: null,
            }),
          }),
        }),
      }),
    });
    mockVerifyTurnstileToken.mockResolvedValue({ success: true });
  });

  it("notifies DSAR staff when a request is submitted", async () => {
    const response = await POST(
      createRequest({
        type: "access",
        name: "Nomsa Dlamini",
        email: "nomsa@example.com",
        idNumber: "8001015009087",
        details: "Please send me a copy of my personal data.",
        turnstileToken: "turnstile-ok",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reference: expect.stringMatching(/^DSAR-/),
    });
    expect(mockNotifyStaffForAdminEvent).toHaveBeenCalledWith({
      capability: "dsar:manage",
      title: "New data request submitted",
      message: expect.stringContaining("request"),
      href: "/admin/dsar",
      excludeUserId: "member-1",
    });
  });
});
