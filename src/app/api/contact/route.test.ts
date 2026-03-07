import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCreateNotification,
  mockCheckRateLimit,
  mockFrom,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/notifications", () => ({
  createNotification: mockCreateNotification,
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

import { POST } from "./route";

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
    headers: new Headers(),
  } as unknown as NextRequest;
}

describe("POST /api/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateNotification.mockResolvedValue(true);
  });

  it("creates a seller notification for anonymous contact requests", async () => {
    const sellerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockImplementation((fields: string) => {
            if (fields === "seller_id") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { seller_id: sellerId },
                    error: null,
                  }),
                }),
              };
            }

            if (fields === "title") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { title: "Vintage Couch" },
                    error: null,
                  }),
                }),
              };
            }

            return {};
          }),
        };
      }

      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { seller_verification_status: "verified" },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "contact_events" || table === "leads") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      return {};
    });

    const response = await POST(
      createMockRequest({
        listingId,
        message: "Hi there, I want to buy this today.",
        contactMethod: "form",
        turnstileToken: "token",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "203.0.113.10",
      action: "contact:send",
    });
    expect(mockCreateNotification).toHaveBeenCalledWith({
      userId: sellerId,
      type: "info",
      title: "New lead received!",
      message: 'Someone is interested in "Vintage Couch".',
      href: "/dashboard/leads",
    });
  });
});
