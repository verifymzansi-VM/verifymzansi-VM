import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const { mockCreateClient, mockFrom } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockFrom: vi.fn(),
}));

const { mockCheckRateLimit } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: mockCheckRateLimit,
}));

import { GET } from "./route";

describe("GET /api/verification/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ limited: false });
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
              data: [
                {
                  step_type: "phone",
                  status: "approved",
                  reviewed_at: "2026-03-12T12:00:00.000Z",
                  reason_code: null,
                  reason_note: null,
                  risk_level: null,
                  submitted_at: "2026-03-12T11:59:00.000Z",
                },
              ],
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
    expect(body.steps[0]).toMatchObject({
      step_type: "phone",
      status: "approved",
      reviewed_at: "2026-03-12T12:00:00.000Z",
    });
  });

  it("returns 429 when verification status polling is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({ limited: true, retryAfter: 12 });

    const response = await GET({} as unknown as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(body.error).toMatch(/Too many verification status requests/i);
  });

  it("falls back to incomplete when account has no verification status", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "profile-1",
                  account_verification_status: null,
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
    expect(body.accountVerificationStatus).toBe("incomplete");
    expect(body.overallStatus).toBe("incomplete");
  });

  it("returns steps with incomplete status when the account profile does not exist", async () => {
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
    expect(body.accountVerificationStatus).toBe("incomplete");
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].step_type).toBe("phone");
  });

  it("returns verified when all verification steps are approved but the profile is stale", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === ACCOUNT_PROFILE_WRITE_TABLE) {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "profile-1",
                  account_verification_status: "incomplete",
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
              data: [
                { step_type: "phone", status: "approved" },
                { step_type: "id_doc", status: "approved" },
                { step_type: "selfie", status: "approved" },
                { step_type: "location", status: "approved" },
              ],
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
  });
});
