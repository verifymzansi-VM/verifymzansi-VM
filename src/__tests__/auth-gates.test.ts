import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/roles", () => ({
  isStaff: (user: { app_metadata: Record<string, unknown> } | null) => {
    if (!user) return false;
    const role = user.app_metadata?.role;
    return role === "admin" || role === "moderator";
  },
}));

vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_WRITE_TABLE: "account_profiles",
  readAccountVerificationStatus: (profile: Record<string, unknown> | null) =>
    profile?.account_verification_status ?? null,
}));

vi.mock("@/lib/account/verification-summary", () => ({
  summarizeVerification: (
    status: string | null | undefined,
    steps: Array<{ step_type: string; status: string }>
  ) => {
    const allApproved = steps.length > 0 && steps.every((s) => s.status === "approved");
    return {
      accountVerificationStatus: status === "verified" || allApproved ? "verified" : "incomplete",
    };
  },
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  checkAdminGate,
  checkPhoneGate,
  checkBanEnforcement,
  checkPostingGate,
} from "@/lib/middleware/auth-gates";

function createRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method });
}

function mockSupabase(overrides: {
  profileData?: Record<string, unknown> | null;
  profileError?: { message: string; code?: string } | null;
  stepsData?: Array<{ step_type: string; status: string }>;
  stepsError?: { message: string; code?: string } | null;
  updateResult?: { error: null };
  /** Simulate the auto-unsuspend update chain result */
  unsuspendResult?: { error?: { message: string } | null };
}) {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "verification_steps") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: overrides.stepsData ?? [],
            error: overrides.stepsError ?? null,
          }),
        };
      }
      // account_profiles
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: overrides.profileData ?? null,
          error: overrides.profileError ?? null,
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            error: overrides.unsuspendResult?.error ?? null,
          }),
        }),
      };
    }),
  } as unknown as Parameters<typeof checkPhoneGate>[2];
}

// ── checkAdminGate ──────────────────────────────────────────────────

describe("checkAdminGate", () => {
  it("returns null for non-admin routes", () => {
    const result = checkAdminGate(createRequest("/dashboard"), null);
    expect(result).toBeNull();
  });

  it("redirects unauthenticated users on /admin to /login", () => {
    const result = checkAdminGate(createRequest("/admin"), null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307);
    expect(new URL(result!.headers.get("location")!).pathname).toBe("/login");
  });

  it("returns 401 for unauthenticated API admin requests", () => {
    const result = checkAdminGate(createRequest("/api/admin/stats"), null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("redirects non-staff users to /dashboard", () => {
    const result = checkAdminGate(createRequest("/admin"), {
      app_metadata: { role: "seller" },
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(307);
    expect(new URL(result!.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("returns 403 for non-staff API admin requests", () => {
    const result = checkAdminGate(createRequest("/api/admin/stats"), {
      app_metadata: { role: "seller" },
    });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  it("allows admin users through", () => {
    const result = checkAdminGate(createRequest("/admin/users"), {
      app_metadata: { role: "admin" },
    });
    expect(result).toBeNull();
  });

  it("allows moderator users through", () => {
    const result = checkAdminGate(createRequest("/admin/reports"), {
      app_metadata: { role: "moderator" },
    });
    expect(result).toBeNull();
  });
});

// ── checkPhoneGate ──────────────────────────────────────────────────

describe("checkPhoneGate", () => {
  it("skips gate for API routes", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkPhoneGate(
      createRequest("/api/dashboard/data"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
  });

  it("skips gate for non-phone-gated routes", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkPhoneGate(
      createRequest("/marketplace"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
  });

  it("skips gate for complete-profile route", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkPhoneGate(
      createRequest("/dashboard/complete-profile"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
  });

  it("redirects to complete-profile when phone is missing", async () => {
    const supabase = mockSupabase({
      profileData: { phone: null, account_status: "active" },
    });
    const result = await checkPhoneGate(
      createRequest("/dashboard"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    const location = new URL(result.response!.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/complete-profile");
    expect(location.searchParams.get("returnUrl")).toBe("/dashboard");
  });

  it("passes through when phone is present", async () => {
    const supabase = mockSupabase({
      profileData: { phone: "+27600000000", account_status: "active" },
    });
    const result = await checkPhoneGate(
      createRequest("/dashboard"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
    expect(result.profile?.phone).toBe("+27600000000");
  });

  it("reuses cached profile and skips DB call", async () => {
    const supabase = mockSupabase({ profileData: null });
    const cachedProfile = { phone: "+27600000000", account_status: "active" };
    const result = await checkPhoneGate(
      createRequest("/dashboard"),
      NextResponse.next(),
      supabase,
      "user-1",
      cachedProfile
    );
    expect(result.response).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("redirects to error page on DB failure", async () => {
    const supabase = mockSupabase({ profileData: null });
    // Override to throw
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.reject(new Error("connection error")),
        }),
      }),
    }));

    const result = await checkPhoneGate(
      createRequest("/dashboard"),
      NextResponse.next(),
      supabase,
      "user-1",
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    expect(new URL(result.response!.headers.get("location")!).pathname).toBe("/error");
  });
});

// ── checkBanEnforcement ─────────────────────────────────────────────

describe("checkBanEnforcement", () => {
  it("skips non-protected non-mutation routes", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkBanEnforcement(
      createRequest("/marketplace"),
      supabase,
      "user-1",
      false,
      null
    );
    expect(result.response).toBeNull();
  });

  it("blocks banned users on protected routes", async () => {
    const supabase = mockSupabase({
      profileData: { account_status: "banned" },
    });
    const result = await checkBanEnforcement(
      createRequest("/dashboard"),
      supabase,
      "user-1",
      true,
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    expect(new URL(result.response!.headers.get("location")!).pathname).toBe("/banned");
  });

  it("returns 403 for banned users on API routes", async () => {
    const supabase = mockSupabase({
      profileData: { account_status: "banned" },
    });
    const result = await checkBanEnforcement(
      createRequest("/api/post/create", "POST"),
      supabase,
      "user-1",
      false,
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(403);
  });

  it("redirects suspended users to /dashboard?suspended=true", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_status: "suspended",
        suspended_until: "2099-12-31T00:00:00Z",
      },
    });
    const result = await checkBanEnforcement(
      createRequest("/billing"),
      supabase,
      "user-1",
      true,
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    const location = new URL(result.response!.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard");
    expect(location.searchParams.get("suspended")).toBe("true");
  });

  it("auto-unsuspends users when suspendedUntil has passed and DB update succeeds", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_status: "suspended",
        suspended_until: "2020-01-01T00:00:00Z",
      },
      unsuspendResult: { error: null },
    });
    const result = await checkBanEnforcement(
      createRequest("/billing"),
      supabase,
      "user-1",
      true,
      null
    );
    expect(result.response).toBeNull();
  });

  it("still treats user as suspended when auto-unsuspend DB update errors", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_status: "suspended",
        suspended_until: "2020-01-01T00:00:00Z",
      },
      unsuspendResult: { error: { message: "connection lost" } },
    });
    const result = await checkBanEnforcement(
      createRequest("/billing"),
      supabase,
      "user-1",
      true,
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
  });

  it("allows active users through", async () => {
    const supabase = mockSupabase({
      profileData: { account_status: "active" },
    });
    const result = await checkBanEnforcement(
      createRequest("/dashboard"),
      supabase,
      "user-1",
      true,
      null
    );
    expect(result.response).toBeNull();
  });

  it("returns 503 on DB failure for API routes", async () => {
    const supabase = mockSupabase({
      profileData: null,
      profileError: { message: "connection error", code: "TIMEOUT" },
    });
    const result = await checkBanEnforcement(
      createRequest("/api/post/create", "POST"),
      supabase,
      "user-1",
      false,
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(503);
  });
});

// ── checkPostingGate ────────────────────────────────────────────────

describe("checkPostingGate", () => {
  it("skips non-posting routes", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkPostingGate(createRequest("/dashboard"), supabase, "user-1", null);
    expect(result.response).toBeNull();
  });

  it("skips /post/create (category selection)", async () => {
    const supabase = mockSupabase({ profileData: null });
    const result = await checkPostingGate(createRequest("/post/create"), supabase, "user-1", null);
    expect(result.response).toBeNull();
  });

  it("allows verified users to create listings", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_verification_status: "verified",
        account_status: "active",
      },
    });
    const result = await checkPostingGate(
      createRequest("/post/create-business"),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
  });

  it("redirects unverified users to /verification with returnUrl", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_verification_status: "incomplete",
        account_status: "active",
      },
      stepsData: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "pending" },
      ],
    });
    const result = await checkPostingGate(
      createRequest("/post/create-business"),
      supabase,
      "user-1",
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    const location = new URL(result.response!.headers.get("location")!);
    expect(location.pathname).toBe("/verification");
    expect(location.searchParams.get("returnUrl")).toBe("/post/create-business");
  });

  it("returns 403 for unverified users on API posting routes", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_verification_status: "incomplete",
        account_status: "active",
      },
      stepsData: [],
    });
    const result = await checkPostingGate(
      createRequest("/api/post/create"),
      supabase,
      "user-1",
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(403);
  });

  it("allows posting when legacy status is stale but all steps are approved", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_verification_status: "incomplete",
        account_status: "active",
      },
      stepsData: [
        { step_type: "phone", status: "approved" },
        { step_type: "id_doc", status: "approved" },
        { step_type: "selfie", status: "approved" },
        { step_type: "location", status: "approved" },
      ],
    });
    const result = await checkPostingGate(
      createRequest("/post/create-business"),
      supabase,
      "user-1",
      null
    );
    expect(result.response).toBeNull();
  });

  it("blocks banned users from posting", async () => {
    const supabase = mockSupabase({
      profileData: {
        account_verification_status: "verified",
        account_status: "banned",
      },
    });
    const result = await checkPostingGate(
      createRequest("/post/edit/123"),
      supabase,
      "user-1",
      null
    );
    expect(result.response).not.toBeNull();
    expect(result.response!.status).toBe(307);
    expect(new URL(result.response!.headers.get("location")!).pathname).toBe("/banned");
  });
});
