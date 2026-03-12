import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

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

  it("creates an account holder notification for anonymous contact requests", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockImplementation((fields: string) => {
            if (fields === "owner_id, title") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { owner_id: ownerId, title: "Vintage Couch" },
                    error: null,
                  }),
                }),
              };
            }

            return {};
          }),
        };
      }

      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  account_verification_status: "verified",
                },
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
      userId: ownerId,
      type: "info",
      title: "New lead received!",
      message: 'Someone is interested in "Vintage Couch".',
      href: "/dashboard/leads",
    });
  });

  it("records the canonical member verification flag on contact events", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";
    const contactInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockImplementation((fields: string) => {
            if (fields === "owner_id, title") {
              return {
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { owner_id: ownerId, title: "Vintage Couch" },
                    error: null,
                  }),
                }),
              };
            }

            return {};
          }),
        };
      }

      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  account_verification_status: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "contact_events") {
        return {
          insert: contactInsert,
        };
      }

      if (table === "leads") {
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

    expect(response.status).toBe(200);
    expect(contactInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        member_verified: false,
      })
    );
  });

  it("accepts promotion enquiries and stores them against the promotion target", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const promotionId = "33333333-3333-4333-8333-333333333333";
    const contactInsert = vi.fn().mockResolvedValue({ error: null });
    const leadInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "promotions") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { owner_id: ownerId, title: "Launch Week Promo" },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === ACCOUNT_PROFILE_WRITE_TABLE || table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  account_verification_status: "verified",
                },
                error: null,
              }),
            }),
          }),
        };
      }

      if (table === "contact_events") {
        return {
          insert: contactInsert,
        };
      }

      if (table === "leads") {
        return {
          insert: leadInsert,
        };
      }

      return {};
    });

    const response = await POST(
      createMockRequest({
        promotionId,
        message: "Hi, I want details about this promo.",
        contactMethod: "form",
        turnstileToken: "token",
      })
    );

    expect(response.status).toBe(200);
    expect(contactInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: promotionId,
        target_type: "promotion",
        owner_id: ownerId,
      })
    );
    expect(leadInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_id: promotionId,
        target_type: "promotion",
      })
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ownerId,
        message: 'Someone is interested in "Launch Week Promo".',
      })
    );
  });
});
