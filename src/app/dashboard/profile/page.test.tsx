/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const mockRouter = { push: mockPush, refresh: mockRefresh };

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
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

vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => ({
    auth: {
      getUser: mockGetUser,
      signOut: mockSignOut,
      signInWithPassword: mockSignInWithPassword,
      mfa: {
        listFactors: async () => ({
          data: { totp: [{ id: "factor", status: "verified" }] },
          error: null,
        }),
        challengeAndVerify: async () => ({ error: null }),
      },
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

  it("saves a bio with the loaded native revision even when the locked legal name exceeds the editable-name limit", async () => {
    const originalFrom = mockFrom.getMockImplementation()!;
    const legalName = `${"A".repeat(50)} ${"B".repeat(50)}`;
    mockFrom.mockImplementation((table: string) =>
      table !== "account_profiles"
        ? originalFrom(table)
        : {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    display_name: legalName,
                    bio: "",
                    phone: "+27821234567",
                    legal_name_locked_at: "2026-11-03T12:00:00Z",
                    revision: 7,
                  },
                  error: null,
                }),
              }),
            }),
          }
    );
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, profile: { revision: 8 } }),
    } as Response);
    try {
      render(<ProfilePage />);
      await screen.findByDisplayValue(legalName);
      fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Updated bio" } });
      fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
      await waitFor(() =>
        expect(global.fetch).toHaveBeenCalledWith("/api/profile/update", expect.anything())
      );
      const first = vi
        .mocked(global.fetch)
        .mock.calls.find(([url]) => url === "/api/profile/update")!;
      expect(JSON.parse(String(first[1]?.body))).toMatchObject({
        bio: "Updated bio",
        expectedRevision: 7,
      });
      expect(JSON.parse(String(first[1]?.body))).not.toHaveProperty("displayName");
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Profile updated!" })
        )
      );
      fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "Second bio" } });
      fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
      await waitFor(() =>
        expect(
          vi.mocked(global.fetch).mock.calls.filter(([url]) => url === "/api/profile/update")
        ).toHaveLength(2)
      );
      const second = vi
        .mocked(global.fetch)
        .mock.calls.filter(([url]) => url === "/api/profile/update")[1];
      expect(JSON.parse(String(second[1]?.body)).expectedRevision).toBe(8);
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("says plainly what deleting the account does before it can be confirmed", async () => {
    window.location.hash = "#account";
    vi.useFakeTimers({ now: new Date("2026-11-17T10:00:00Z"), toFake: ["Date"] });
    try {
      render(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
      });
      expect(screen.queryByRole("link", { name: "data request" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

      const dialog = screen.getByRole("dialog", { name: "Confirm account deletion" });
      for (const text of [
        "Your account closes as soon as you confirm. You can't undo this or reopen the account yourself.",
        "Your posts leave the site at once and are deleted with your account.",
        /All your slots are cancelled\. Under our Terms, closing your account is a request to cancel them/,
        /minus a R50 fee, so a 30-day slot usually returns nothing/,
        "You are signed out on every device and can't sign in again.",
        /erased on 17 December 2026, 30 days after closing/,
        /We finish your deletion request by 24 December 2026\. If a payment, bank transfer, refund, unpaid invoice, report or hold is still open/,
        "For your safety, this works only within 15 minutes of signing in.",
      ])
        expect(within(dialog).getByText(text)).toBeInTheDocument();
      // The server checks the sign-in's age; no password is asked for here.
      expect(within(dialog).queryByLabelText("Current password")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      window.location.hash = "";
    }
  });

  it("enables Continue only once DELETE is typed", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

    const continueButton = screen.getByRole("button", { name: /^Continue$/i });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELET" },
    });
    expect(continueButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "delete" },
    });
    expect(continueButton).toBeEnabled();
    window.location.hash = "";
  });

  it("offers a fresh sign-in, back to this tab, when the sign-in is too old to delete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          code: "reauthentication_required",
          reason: "recent_sign_in_required",
          error: "For your safety, sign in again, then delete your account within 15 minutes.",
        }),
      })
    );
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
      fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "Account deletion failed",
          description:
            "For your safety, sign in again, then delete your account within 15 minutes.",
          variant: "destructive",
        })
      );
      fireEvent.click(await screen.findByRole("button", { name: "Sign in again" }));
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          "http://localhost/login?returnUrl=%2Fdashboard%2Fprofile%23account"
        )
      );
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("shows the server's explanation when a staff account tries to delete itself", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          reason: "staff_account",
          error:
            "A staff account can't be deleted while it has a staff role. Ask another administrator to end your staff roles first.",
        }),
      })
    );
    window.location.hash = "#account";
    render(<ProfilePage />);
    await screen.findByRole("heading", { name: "My profile" });
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Account deletion failed",
          description:
            "A staff account can't be deleted while it has a staff role. Ask another administrator to end your staff roles first.",
        })
      )
    );
    expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Confirm account deletion" })).toBeInTheDocument();
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

  async function submitPasswordChange() {
    window.location.hash = "#security";
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /^Change$/ }));
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "OldPassword123!" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewPassword123!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "NewPassword123!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    window.location.hash = "";
  }

  it("offers a fresh sign-in when an old session cannot change credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ code: "reauthentication_required", error: "Sign in again" }),
      })
    );
    await submitPasswordChange();
    expect(await screen.findByRole("link", { name: "Sign in again" })).toHaveAttribute(
      "href",
      "/login?returnUrl=%2Fdashboard%2Fprofile%23security"
    );
  });

  it("preserves typed credentials until the existing authenticator is verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ code: "mfa_required", error: "Verify authenticator" }),
      })
    );
    await submitPasswordChange();
    const code = await screen.findByLabelText("Authenticator code");
    expect(screen.getByRole("button", { name: "Update password" })).toBeDisabled();
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify authenticator" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update password" })).toBeEnabled()
    );
    expect(screen.getByLabelText("New password")).toHaveValue("NewPassword123!");
  });

  it("shows the session-revocation warning returned after a password change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, warning: "Other sessions could not be revoked" }),
      })
    );
    await submitPasswordChange();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Other sessions could not be revoked",
          variant: "default",
        })
      )
    );
  });

  it("says both the current and the new address get a confirmation email", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);
    fireEvent.click(await screen.findByRole("button", { name: /^Change$/ }));
    fireEvent.change(screen.getByPlaceholderText("New email address"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send confirmation" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Confirmation sent",
        description: "Check both your current and new email inboxes to complete the change.",
        variant: "success",
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/account/email/change",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ newEmail: "new@example.com" }),
      })
    );
    window.location.hash = "";
  });

  it("calls account delete API from the delete dialog with the typed word only", async () => {
    window.location.hash = "#account";
    render(<ProfilePage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/account/delete",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ confirmation: "DELETE" }),
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "closed",
          closedAt: "2026-11-17T10:00:00+00:00",
          eraseAfter: "2026-12-17T10:00:00+00:00",
          eraseBy: "2026-12-24T10:00:00.000Z",
        }),
      })
    );

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
      fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith({
          title: "Account deleted",
          description:
            "Your account is closed and you are signed out. It will be erased on 17 December 2026.",
          variant: "success",
        });
      });
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
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
