import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompleteProfilePage from "./page";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

const mockPush = vi.fn();
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockToast = vi.fn();
const mockFrom = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

mockFrom.mockImplementation(() => ({
  select: () => ({
    eq: () => ({
      maybeSingle: mockMaybeSingle,
    }),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("CompleteProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }));
    window.history.replaceState({}, "", "/dashboard/complete-profile");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: "Nomsa", phone: null },
      error: null,
    });
  });

  it("renders phone-only onboarding copy", async () => {
    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Add Your Phone Number" })
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Add your phone number before you continue.")).toBeInTheDocument();
  });

  it("continues to the requested returnUrl when the phone is already present", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/complete-profile?returnUrl=%2Fpost%2Fcreate-listing"
    );
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: "Nomsa", phone: "0712345678" },
      error: null,
    });

    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/post/create-listing");
    });
  });

  it("queries the canonical account profile table", async () => {
    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith(ACCOUNT_PROFILE_TABLE);
    });
    expect(ACCOUNT_PROFILE_TABLE).toBe("account_profiles");
  });
});
