/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./page";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockFrom = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/account/verification-summary", () => ({
  summarizeVerification: vi.fn(() => ({ accountVerificationStatus: "verified" })),
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (h: Record<string, string>) => h,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
      signInWithPassword: mockSignInWithPassword,
    },
    from: mockFrom,
  }),
}));

describe("ProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithPassword.mockResolvedValue({ error: null });

    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    display_name: "Sipho Mokoena",
                    legal_first_name: "Sipho",
                    legal_last_name: "Mokoena",
                    bio: "",
                    location_province: "Gauteng",
                    location_city: "Johannesburg",
                    phone: "+27821234567",
                    account_verification_status: "verified",
                    avatar_url: null,
                    legal_name_locked_at: "2026-03-31T10:00:00Z",
                    location_verified_at: null,
                    contact_last_phone_change_at: null,
                    contact_last_email_change_at: null,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });
  });

  it("shows locked legal first name and surname fields when present", async () => {
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByText("Legal first name")).toBeInTheDocument();
      expect(screen.getByText("Legal surname")).toBeInTheDocument();
    });

    expect(screen.getByText("Sipho")).toBeInTheDocument();
    expect(screen.getByText("Mokoena")).toBeInTheDocument();

    const displayNameInput = screen.getByLabelText(/Display Name/i);
    expect(displayNameInput).toBeDisabled();
  });

  it("hides legal name block when legal names are missing", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    display_name: "Nomsa",
                    legal_first_name: null,
                    legal_last_name: null,
                    bio: "",
                    location_province: null,
                    location_city: null,
                    phone: "+27821234567",
                    account_verification_status: "pending_review",
                    avatar_url: null,
                    legal_name_locked_at: null,
                    location_verified_at: null,
                    contact_last_phone_change_at: null,
                    contact_last_email_change_at: null,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }

      if (table === "verification_steps") {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }

      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My Profile" })).toBeInTheDocument();
    });

    expect(screen.queryByText("Legal first name")).not.toBeInTheDocument();
    expect(screen.queryByText("Legal surname")).not.toBeInTheDocument();
  });

  it("requires DELETE text and current password before enabling delete continue", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My Profile" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

    const continueButton = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "MyPassword123!" },
    });

    expect(continueButton).toBeEnabled();
    window.location.hash = "";
  });
});
