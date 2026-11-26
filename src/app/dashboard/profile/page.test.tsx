/// <reference types="vitest/globals" />
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "./page";
import { useAuthStore } from "@/stores/auth-store";
import { useNotificationStore } from "@/stores/notification-store";
import type * as HiddenFeatures from "@/lib/hidden-features";

// "Delete account" is hidden until it works (src/lib/hidden-features.ts); the
// tests switch it on to keep the code behind the switch checked.
const hiddenFeature = vi.hoisted(() => ({ shown: true }));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  get SHOW_ACCOUNT_DELETION() {
    return hiddenFeature.shown;
  },
}));

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
  }),
  // The page's two explicit reads, served from the per-test table stubs below.
  readRestoredOwnProfile: async (_client: unknown, owner: string) =>
    (await mockFrom("account_profiles").select().eq("user_id", owner).maybeSingle()).data,
  readRestoredVerificationSteps: async (_client: unknown, owner: string, statuses: string[]) =>
    (await mockFrom("verification_steps").select().eq("user_id", owner).in("status", statuses))
      .data,
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

  it("LIM-APP-avatar-precheck: uploads a 2 MB photo, refuses one byte more before uploading", async () => {
    const avatarUploads = () =>
      vi.mocked(global.fetch).mock.calls.filter(([url]) => url === "/api/profile/avatar");
    const choose = (bytes: number) => {
      const file = new File(["png"], "me.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: bytes });
      fireEvent.change(screen.getByLabelText("Upload avatar image"), {
        target: { files: [file] },
      });
    };
    render(<ProfilePage />);
    await screen.findByText("Legal first name");

    choose(2 * 1024 * 1024 + 1);
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "File too large" }))
    );
    expect(avatarUploads()).toHaveLength(0);

    choose(2 * 1024 * 1024);
    await waitFor(() => expect(avatarUploads()).toHaveLength(1));
    const tooLarge = mockToast.mock.calls.filter(([toast]) => toast.title === "File too large");
    expect(tooLarge).toHaveLength(1);
  });

  it("changes the verified phone only through a new code and keeps the place editable", async () => {
    render(<ProfilePage />);

    const change = await screen.findByRole("link", { name: "Change number" });
    expect(change).toHaveAttribute(
      "href",
      "/dashboard/complete-profile?change=1&returnUrl=%2Fdashboard%2Fprofile"
    );
    expect(screen.getByLabelText("Phone")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Province")).toBeEnabled();
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

  it("while account deletion is hidden, offers a data request instead of Delete", async () => {
    window.location.hash = "#account";
    hiddenFeature.shown = false;
    try {
      render(<ProfilePage />);
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "My profile" })).toBeInTheDocument();
      });
      expect(screen.getByRole("link", { name: "data request" })).toHaveAttribute("href", "/dsar");
      expect(screen.queryByRole("button", { name: /^Delete$/i })).not.toBeInTheDocument();
    } finally {
      hiddenFeature.shown = true;
      window.location.hash = "";
    }
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
      // The row says what is kept, not "for good".
      expect(
        screen.getByText(
          /Closes your account and erases your data, except records we must keep by law, such as payments, invoices and ID-check history\. See our/
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/for good/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));

      const dialog = screen.getByRole("dialog", { name: "Confirm account deletion" });
      for (const text of [
        "Your account closes as soon as you confirm. You can't undo this or reopen the account yourself.",
        "Your posts leave the site at once and are deleted with your account.",
        "As our Terms say, closing your account counts as a request to cancel all your slots and your Multi-listing package. If you are an individual or sole trader, we work out any credit for unused days after the 20-business-day notice period, minus a R50 fee; a 30-day slot usually returns nothing. Companies and other buyers that are not individuals get no credit.",
        "You are signed out on every device and can't sign in again.",
        "Erasing your profile, posts, enquiries, photos and videos is planned for 17 December 2026, 30 days after closing. If a payment, refund, invoice, report or legal hold is still open, erasure waits until it is settled.",
        /^Payment records and invoices are kept for 5 years for tax, as the law requires\. Some other records, such as ID-check history, are kept as our/,
        "For your safety, this works only within 15 minutes of signing in with your password or Google.",
      ])
        expect(within(dialog).getByText(text)).toBeInTheDocument();
      // Nothing promises an automatic credit, a cancelled slot or a fixed erasure.
      expect(dialog).not.toHaveTextContent(
        /slots are cancelled|are credited|erased on|without your name|finish your deletion request by/
      );
      for (const link of within(dialog).getAllByRole("link", { name: "Privacy Policy" }))
        expect(link).toHaveAttribute("href", "/privacy#retention");
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

  it("explains a refused session (ended, or the address unconfirmed) without signing out", async () => {
    const message =
      "Your session has ended or your email address is not confirmed. If you just deleted your account, it is closed; otherwise confirm your email address, sign in again and try again.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          reason: "session_required",
          code: "session_required",
          error: message,
        }),
      })
    );
    window.location.hash = "#account";
    try {
      await confirmDeletion();
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Sign in again", description: message })
        )
      );
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "You are signed out" })
      );
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Confirm account deletion" })).toBeNull();
    } finally {
      window.location.hash = "";
    }
  });

  async function confirmDeletion() {
    render(<ProfilePage />);
    await screen.findByRole("heading", { name: "My profile" });
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
  }

  it.each([
    ["the reply is lost", () => vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))],
    [
      "the reply is not JSON (a gateway page)",
      () =>
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }),
    ],
    [
      "the server says the outcome is unknown",
      () =>
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: async () => ({
            code: "outcome_unknown",
            error:
              "We couldn't confirm whether your account was closed. Try signing in: if you can't, it was closed. Contact support if unsure.",
          }),
        }),
    ],
  ])("never says the account was not closed when %s", async (_, makeFetch) => {
    vi.stubGlobal("fetch", makeFetch());
    window.location.hash = "#account";
    await confirmDeletion();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith({
        title: "Account status unknown",
        description:
          "We couldn't confirm whether your account was closed. Try signing in: if you can't, it was closed. Contact support if unsure.",
        variant: "destructive",
      })
    );
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Account deletion failed" })
    );
    window.location.hash = "";
  });

  it("after a lost answer, a retry that finds the session gone says so and goes to sign-in", async () => {
    const message =
      "You are signed out. If you just deleted your account, it is closed; otherwise sign in again to delete it.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: message }) })
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
      await confirmDeletion();
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith({
          title: "You are signed out",
          description: message,
          variant: "destructive",
        })
      );
      expect(screen.queryByRole("button", { name: "Sign in again" })).not.toBeInTheDocument();
      await waitFor(
        () =>
          expect(assign).toHaveBeenCalledWith(
            "http://localhost/login?returnUrl=%2Fdashboard%2Fprofile%23account"
          ),
        { timeout: 3000 }
      );
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
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
          title: "Account closed",
          description:
            "Your account is closed and you are signed out. Erasure is planned for 17 December 2026; it waits while a payment, refund, invoice, report or legal hold is still open.",
          variant: "success",
        });
      });
      expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
      // A second try is impossible: the page shows the account closed.
      expect(screen.queryByRole("button", { name: /^Delete$/i })).not.toBeInTheDocument();
      expect(
        screen.getByText("Your account is closed. Erasure is planned for 17 December 2026.")
      ).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

  it("drops the delayed redirect when the page unmounts before it fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "closed" }) })
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
      const { unmount } = render(<ProfilePage />);
      await screen.findByRole("heading", { name: "My profile" });
      fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
      fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), {
        target: { value: "DELETE" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Continue$/i }));
      await waitFor(() =>
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Account closed" }))
      );
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 1800));
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
