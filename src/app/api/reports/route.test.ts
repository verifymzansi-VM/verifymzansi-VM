import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCheckRateLimit,
  mockNotifyStaffForAdminEvent,
  mockVerifyTurnstileToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockNotifyStaffForAdminEvent: vi.fn().mockResolvedValue(true),
  mockVerifyTurnstileToken: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("203.0.113.10"),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
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

vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}));

import { POST } from "./route";

function createRequest(body: Record<string, unknown>) {
  return {
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("POST /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "member-1" } },
        }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    });
    mockVerifyTurnstileToken.mockResolvedValue({ success: true });
  });

  it("notifies staff when a report is submitted", async () => {
    const response = await POST(
      createRequest({
        targetType: "listing",
        targetId: "11111111-1111-4111-8111-111111111111",
        reason: "scam",
        description: "This listing is misleading and looks fraudulent.",
        turnstileToken: "turnstile-ok",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(mockNotifyStaffForAdminEvent).toHaveBeenCalledWith({
      capability: "queue:view",
      title: "New report submitted",
      message: "A new report is waiting in the reports queue.",
      href: "/admin/reports",
      excludeUserId: "member-1",
    });
  });
});
