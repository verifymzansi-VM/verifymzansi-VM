import { beforeEach, describe, expect, it, vi } from "vitest";
import { type NextRequest } from "next/server";

const { mockCreateClient, mockCreateAdminClient, mockFrom } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { POST } from "./route";

function createMockRequest(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  return {
    text: async () => json,
  } as unknown as NextRequest;
}

describe("POST /api/verification/location", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAdminClient.mockReturnValue({ from: mockFrom });
  });

  it("returns 401 when user is not authenticated", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const response = await POST(createMockRequest({ province: "Gauteng", city: "Johannesburg" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 404 when account profile is missing", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }

      return {};
    });

    const response = await POST(createMockRequest({ province: "Gauteng", city: "Johannesburg" }));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Account profile not found");
  });

  it("returns 500 when verification step upsert fails", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          upsert: vi.fn().mockResolvedValue({ error: { message: "boom" } }),
        };
      }

      return {};
    });

    const response = await POST(createMockRequest({ province: "Gauteng", city: "Johannesburg" }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to submit location verification step");
  });

  it("saves location and creates location verification step", async () => {
    const updateMock = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      if (payload.account_verification_status || payload.seller_verification_status) {
        return {
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    });
    const upsertMock = vi.fn().mockResolvedValue({ error: null });
    const sessionUpsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
      },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "seller_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "profile-1" }, error: null }),
          update: updateMock,
        };
      }

      if (table === "verification_steps") {
        return {
          upsert: upsertMock,
        };
      }

      if (table === "verification_sessions") {
        return {
          upsert: sessionUpsert,
        };
      }

      return {};
    });

    const response = await POST(createMockRequest({ province: "Gauteng", city: "Johannesburg" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({
      location_province: "Gauteng",
      location_city: "Johannesburg",
    });
    expect(updateMock).toHaveBeenCalledWith({
      account_verification_status: "pending_review",
      seller_verification_status: "pending_review",
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        step_type: "location",
        status: "pending",
        reviewed_by: null,
        reviewed_at: null,
        reason_code: null,
        reason_note: null,
        override_reason_code: null,
        location_province: "Gauteng",
        location_city: "Johannesburg",
      }),
      { onConflict: "user_id,step_type" }
    );
    expect(sessionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        location_submitted_at: expect.any(String),
        finalized_at: null,
      }),
      { onConflict: "user_id" }
    );
  });
});
