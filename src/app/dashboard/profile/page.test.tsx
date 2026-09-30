/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./page";
import { useAuthStore } from "@/stores/auth-store";
import { useNotificationStore } from "@/stores/notification-store";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockGetUser = vi.fn();
const mockSignOut = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockFrom = vi.fn();
const mockToast = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      })
    );
    mockSignInWithPassword.mockResolvedValue({ error: null });

    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
          identities: [{ provider: "email" }],
          app_metadata: { provider: "email" },
        },
      },
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
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
    });

    expect(screen.queryByText("Legal first name")).not.toBeInTheDocument();
    expect(screen.queryByText("Legal surname")).not.toBeInTheDocument();
  });

  it("requires DELETE text and current password before enabling delete continue", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
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

  it("shows password setup flow for Google-only users", async () => {
    window.location.hash = "#security";
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@gmail.com",
          identities: [{ provider: "google" }],
          app_metadata: { provider: "google" },
        },
      },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Set Password/i })).toBeInTheDocument();
    });

    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Set Password/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/forgot-password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "user@gmail.com" }),
        })
      );
    });
    window.location.hash = "";
  });

  it("does not require a current password before deleting Google-only accounts", async () => {
    window.location.hash = "#account";
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@gmail.com",
          identities: [{ provider: "google" }],
          app_metadata: { provider: "google" },
        },
      },
    });

    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    expect(continueButton).toBeEnabled();
    window.location.hash = "";
  });

  it("calls account delete API from the delete dialog", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "MyPassword123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/account/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            confirmation: "DELETE",
            currentPassword: "MyPassword123!",
          }),
        })
      );
    });
    window.location.hash = "";
  });

  it("clears the deleted account's client state and hard-navigates home after deletion", async () => {
    useAuthStore.getState().setUser({
      id: "user-1",
      email: "user@example.com",
      displayName: "Sipho",
      role: "user",
    });
    useNotificationStore.getState().hydrateNotifications(
      [
        {
          id: "n-1",
          type: "info",
          title: "Old account notification",
          message: "Should not survive deletion",
          read: false,
          createdAt: "2026-09-01T10:00:00Z",
        },
      ],
      1
    );
    document.cookie = "x-phone-ok=1; path=/";

    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "http://localhost",
        href: "http://localhost/dashboard/profile#account",
        pathname: "/dashboard/profile",
        search: "",
        hash: "#account",
        assign,
        replace: vi.fn(),
      },
    });

    try {
      render(<ProfilePage />);
      await screen.findByRole("heading", { name: "My profile" });

      fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
      fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
        target: { value: "DELETE" },
      });
      fireEvent.change(screen.getByLabelText("Current password"), {
        target: { value: "MyPassword123!" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Account deleted", variant: "success" })
        );
      });
      await waitFor(() => {
        expect(useAuthStore.getState().user).toBeNull();
        expect(useNotificationStore.getState().notifications).toHaveLength(0);
      });
      expect(document.cookie).not.toContain("x-phone-ok=1");

      await waitFor(() => expect(assign).toHaveBeenCalledWith("http://localhost/"), {
        timeout: 3000,
      });
      // A soft client-side push would keep the old account's JS state alive.
      expect(mockPush).not.toHaveBeenCalledWith("/");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
