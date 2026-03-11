import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockLogAuditEvent, mockCheckRateLimit } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
    mockCheckRateLimit: vi.fn().mockResolvedValue({ limited: false }),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mockCreateAdminClient }));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { POST } from "@/app/api/listings/route";

const USER_ID = "user-1";
const VALID_IMAGE = "https://media.verifymzansi.com/image.jpg";
const VALID_VIDEO = "https://media.verifymzansi.com/video.mp4";

const VALID_BODY = {
  title: "Apple iPhone 15 Pro",
  description: "A valid listing description that is long enough for the schema to accept it.",
  price_zar: 12000,
  negotiable: false,
  province: "Gauteng",
  city: "Johannesburg",
  category: "electronics",
  attributes: { brand: "Apple" },
  images: [VALID_IMAGE],
};

function createRequest(body: unknown): NextRequest {
  return {
    method: "POST",
    text: async () => JSON.stringify(body),
    headers: { get: vi.fn().mockReturnValue(null) },
  } as unknown as NextRequest;
}

describe("POST /api/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
    });
  });

  it("rejects video uploads when the paid plan disallows them", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
                seller_verification_status: "verified",
              },
            }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "basic" } }),
          };
        }
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockResolvedValue({ count: 0 }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(createRequest({ ...VALID_BODY, videos: [VALID_VIDEO] }));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Video upload is not available on your current plan.",
    });
  });

  it("rejects when api callers exceed the plan video count", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
                seller_verification_status: "verified",
              },
            }),
          };
        }
        if (table === "entitlements") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { tier: "starter" } }),
          };
        }
        if (table === "listings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockResolvedValue({ count: 0 }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(
      createRequest({ ...VALID_BODY, videos: [VALID_VIDEO, `${VALID_VIDEO}?2`] })
    );
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Maximum 1 videos allowed on your plan",
    });
  });

  it("rejects listing media hosted outside the platform", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "verified",
                seller_verification_status: "verified",
              },
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(
      createRequest({
        ...VALID_BODY,
        images: ["https://evil.example.com/not-allowed.jpg"],
      })
    );

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: "Validation failed",
    });
  });

  it("returns verification_required for unverified accounts", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "seller_profiles") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "seller-1",
                account_verification_status: "incomplete",
                seller_verification_status: "incomplete",
              },
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        };
      }),
    });

    const res = await POST(createRequest(VALID_BODY));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Verification required",
      code: "verification_required",
    });
  });
});
