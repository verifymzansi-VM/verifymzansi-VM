import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE, resetOwnerColumnCacheForTesting } from "@/lib/account/compat";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockCreateNotification,
  mockCheckRateLimit,
  mockFrom,
  mockGetUserById,
  mockSendContactFormNotification,
  mockVerifyTurnstileToken,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFrom: vi.fn(),
  mockGetUserById: vi.fn(),
  mockSendContactFormNotification: vi.fn(),
  mockVerifyTurnstileToken: vi.fn(),
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

vi.mock("@/lib/services/email", () => ({
  sendContactFormNotification: mockSendContactFormNotification,
}));

vi.mock("@/lib/utils/turnstile", () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
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
  enforceCsrfToken: vi.fn(() => null),
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
    resetOwnerColumnCacheForTesting();

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
      auth: {
        admin: {
          getUserById: mockGetUserById,
        },
      },
    });
    mockCheckRateLimit.mockResolvedValue({ limited: false });
    mockCreateNotification.mockResolvedValue(true);
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "owner@example.com" } },
      error: null,
    });
    mockSendContactFormNotification.mockResolvedValue({ success: true });
    mockVerifyTurnstileToken.mockResolvedValue({ success: true });
  });

  it("creates an account holder notification for anonymous contact requests", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockImplementation((fields: string) => {
            if (
              fields.includes("owner_id") &&
              fields.includes("title") &&
              fields.includes("status")
            ) {
              return {
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: listingId,
                      owner_id: ownerId,
                      title: "Vintage Couch",
                      status: "live",
                    },
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
    expect(mockSendContactFormNotification).toHaveBeenCalledWith(
      "owner@example.com",
      "there",
      "Interested buyer",
      "not-provided@verifymzansi.com",
      "Hi there, I want to buy this today.",
      "Vintage Couch"
    );
  });

  it("records the canonical member verification flag on contact events", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";
    const contactInsert = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockImplementation((fields: string) => {
            if (
              fields.includes("owner_id") &&
              fields.includes("title") &&
              fields.includes("status")
            ) {
              return {
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: listingId,
                      owner_id: ownerId,
                      title: "Vintage Couch",
                      status: "live",
                    },
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
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: promotionId,
                  owner_id: ownerId,
                  title: "Launch Week Promo",
                  status: "live",
                },
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
    expect(mockSendContactFormNotification).toHaveBeenCalledWith(
      "owner@example.com",
      "there",
      "Interested buyer",
      "not-provided@verifymzansi.com",
      "Hi, I want details about this promo.",
      "Launch Week Promo"
    );
  });

  it("returns 500 when lead persistence fails", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const listingId = "22222222-2222-4222-8222-222222222222";

    mockFrom.mockImplementation((table: string) => {
      if (table === "listings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: listingId,
                  owner_id: ownerId,
                  title: "Vintage Couch",
                  status: "live",
                },
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
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }

      if (table === "leads") {
        return {
          insert: vi.fn().mockResolvedValue({
            error: { message: "new row violates check constraint leads_message_check" },
          }),
        };
      }

      return {};
    });

    const response = await POST(
      createMockRequest({
        listingId,
        message: "This message is long enough.",
        contactMethod: "form",
        turnstileToken: "token",
      })
    );
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to send message");
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendContactFormNotification).not.toHaveBeenCalled();
  });
});
