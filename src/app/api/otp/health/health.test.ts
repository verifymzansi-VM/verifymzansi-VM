import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetUser, mockVerifyStaffActorRoleFromDb, mockAdminFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockVerifyStaffActorRoleFromDb: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("@/lib/auth/admin-access", () => ({
  verifyStaffActorRoleFromDb: mockVerifyStaffActorRoleFromDb,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockAdminFrom }),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { GET } from "@/app/api/otp/health/route";

function stubOtpEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  vi.stubEnv("AFRICASTALKING_API_KEY", "at-key");
  vi.stubEnv("AFRICASTALKING_USERNAME", "at-username");
}

function mockHealthyAdmin() {
  mockAdminFrom.mockReturnValue({
    select: vi.fn().mockResolvedValue({ count: 0, error: null }),
  });
}

describe("GET /api/otp/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubOtpEnv();
    mockHealthyAdmin();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await GET();
    const body = await res.json();

    // As implemented: the staff gate returns 403 for anonymous callers too.
    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
    expect(mockVerifyStaffActorRoleFromDb).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-staff users", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", app_metadata: { role: "member" } } },
      error: null,
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(false);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
  });

  it("returns 200 with the aggregated healthy status for staff when all checks pass", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
      error: null,
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(true);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "healthy",
      detail: "All checks passed",
    });
    expect(body.requestId).toEqual(expect.any(String));
    expect(mockAdminFrom).toHaveBeenCalledWith("otp_challenges");
    expect(mockAdminFrom).toHaveBeenCalledWith("otp_logs");
  });

  it("returns 503 with the aggregated unhealthy status when a subsystem check fails", async () => {
    vi.stubEnv("AFRICASTALKING_API_KEY", "");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
      error: null,
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(true);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      status: "unhealthy",
      detail: "One or more subsystem checks failed",
    });
  });

  it("reports unhealthy when the otp_challenges table query fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "admin-1", app_metadata: { role: "admin" } } },
      error: null,
    });
    mockVerifyStaffActorRoleFromDb.mockResolvedValue(true);
    mockAdminFrom.mockImplementation((table: string) => ({
      select: vi
        .fn()
        .mockResolvedValue(
          table === "otp_challenges"
            ? { count: null, error: { message: "relation does not exist" } }
            : { count: 0, error: null }
        ),
    }));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("unhealthy");
  });
});
