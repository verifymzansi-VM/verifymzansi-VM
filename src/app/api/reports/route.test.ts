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

  const baseReport = {
    targetType: "listing",
    targetId: "11111111-1111-4111-8111-111111111111",
    reason: "scam",
    turnstileToken: "turnstile-ok",
  };

  it("rejects a description that exceeds the stored limit once HTML-escaped", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    // 2000 raw characters pass the schema, but "&" escapes to "&amp;".
    const response = await POST(createRequest({ ...baseReport, description: "&".repeat(2000) }));

    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
    expect(mockVerifyTurnstileToken).not.toHaveBeenCalled();
  });

  it("rejects a description that is too short once tags are stripped", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    const response = await POST(
      createRequest({ ...baseReport, description: "<b></b><i></i>scam" })
    );

    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("stores the sanitised description", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) });

    const response = await POST(
      createRequest({ ...baseReport, description: "Price is R5 & seller says <b>pay first</b>" })
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Price is R5 &amp; seller says pay first" })
    );
  });

  it("reports a failed insert as an error, not success", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: { message: "column does not exist" } }),
      }),
    });

    const response = await POST(
      createRequest({ ...baseReport, description: "This listing is misleading and fraudulent." })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBeUndefined();
    expect(body.error).toMatch(/could not submit your report/i);
    expect(JSON.stringify(body)).not.toContain("column does not exist");
    expect(mockNotifyStaffForAdminEvent).not.toHaveBeenCalled();
  });
});
