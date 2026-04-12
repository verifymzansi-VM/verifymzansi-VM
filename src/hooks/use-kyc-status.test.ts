import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockStepsSelect = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: mockStepsSelect,
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_WRITE_TABLE: "account_profiles",
  readAccountVerificationStatus: vi.fn(
    (profile: Record<string, unknown> | null) => profile?.account_verification_status
  ),
}));

import { useKycStatus } from "./use-kyc-status";

describe("useKycStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "unverified" when no user is logged in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useKycStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.status).toBe("unverified");
    expect(result.current.isVerified).toBe(false);
  });

  it('returns "verified" when profile shows verified status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { account_verification_status: "verified" },
      error: null,
    });

    const { result } = renderHook(() => useKycStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.status).toBe("verified");
    expect(result.current.isVerified).toBe(true);
  });

  it('returns "rejected" when profile shows rejected status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-2" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { account_verification_status: "rejected" },
      error: null,
    });

    const { result } = renderHook(() => useKycStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.status).toBe("rejected");
  });

  it('returns "pending" when there are pending verification steps', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-3" } } });
    mockMaybeSingle.mockResolvedValue({
      data: { account_verification_status: "pending" },
      error: null,
    });
    mockStepsSelect.mockResolvedValue({
      data: [{ id: "s-1", step_type: "id_doc", status: "pending", created_at: "2026-01-01" }],
      error: null,
    });

    const { result } = renderHook(() => useKycStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.status).toBe("pending");
    expect(result.current.isPending).toBe(true);
    expect(result.current.nextStep).toBe("id_doc");
  });

  it('returns "unverified" when profile query fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-4" } } });
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "DB error" },
    });

    const { result } = renderHook(() => useKycStatus());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.status).toBe("unverified");
  });
});
