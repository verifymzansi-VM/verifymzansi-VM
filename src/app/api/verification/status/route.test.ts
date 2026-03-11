import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const { mockCreateClient, mockFrom } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

import { GET } from "./route";

describe("GET /api/verification/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: mockFrom,
    });
  });

  it("returns 401 when the user is not authenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
      from: mockFrom,
    });

    const response = await GET({} as unknown as NextRequest);

    expect(response.status).toBe(401);
  });

  it("returns account-first verification status while keeping overallStatus compatible", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "profile-1",
                  account_verification_status: "verified",
                  seller_verification_status: "rejected",
                },
              }),
            }),
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ step_type: "phone", status: "approved" }],
            }),
          }),
        };
      }

      return {};
    });

    const response = await GET({} as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accountVerificationStatus).toBe("verified");
    expect(body.overallStatus).toBe("verified");
    expect(body.steps).toHaveLength(1);
  });

  it("falls back to the legacy seller verification status when needed", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "profile-1",
                  account_verification_status: null,
                  seller_verification_status: "pending_review",
                },
              }),
            }),
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
            }),
          }),
        };
      }

      return {};
    });

    const response = await GET({} as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accountVerificationStatus).toBe("pending_review");
    expect(body.overallStatus).toBe("pending_review");
  });

  it("returns 404 when the account profile does not exist", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await GET({} as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Account profile not found");
  });
});
