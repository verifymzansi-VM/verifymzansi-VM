import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompleteProfilePage from "./page";

const mockPush = vi.fn();
const mockFetch = vi.fn();
const mockGetUser = vi.fn();
const mockReadOwnProfile = vi.fn();
const mockToast = vi.fn();
const mockFrom = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (h: Record<string, string>) => h,
}));

vi.mock("@/lib/utils/format", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  formatPhone: (p: string) => p,
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

const mockClient = { auth: { getUser: mockGetUser }, from: mockFrom };

vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: () => mockClient,
  readRestoredOwnProfile: (...args: unknown[]) => mockReadOwnProfile(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe("CompleteProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/dashboard/complete-profile");
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mockReadOwnProfile.mockResolvedValue({ display_name: "Nomsa", phone: null });
    global.fetch = mockFetch;
  });

  it("renders verify-phone onboarding copy", async () => {
    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Verify your phone number" })
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("We send a 6-digit code by SMS to confirm the number is yours.")
    ).toBeInTheDocument();
  });

  it("continues to the requested returnUrl when the phone is already present", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/complete-profile?returnUrl=%2Fpost%2Fcreate-listing"
    );
    mockReadOwnProfile.mockResolvedValue({ display_name: "Nomsa", phone: "0712345678" });

    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/post/create-listing");
    });
  });

  it("reads the member's own profile by name, without a table-style call", async () => {
    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(mockReadOwnProfile).toHaveBeenCalledWith(mockClient, "user-1");
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("keeps the number field empty when the profile cannot be read", async () => {
    mockReadOwnProfile.mockResolvedValue(null);

    render(<CompleteProfilePage />);

    const input = (await screen.findByLabelText(/SA mobile number/i)) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("pre-fills phone input from pending_phone", async () => {
    mockReadOwnProfile.mockResolvedValue({
      display_name: "Nomsa",
      phone: null,
      pending_phone: "+27711234567",
    });

    render(<CompleteProfilePage />);

    await waitFor(() => {
      const input = screen.getByLabelText(/SA mobile number/i) as HTMLInputElement;
      expect(input.value).not.toBe("");
    });
  });

  it("sends OTP and advances to OTP step on success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));

    const phoneInput = screen.getByLabelText(/SA mobile number/i);
    await user.clear(phoneInput);
    await user.type(phoneInput, "0711234567");

    const sendBtn = screen.getByRole("button", { name: /Send code/i });
    await user.click(sendBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/otp/send",
        expect.objectContaining({ method: "POST" })
      );
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
    });
  });

  it("shows the verified phone state and continues on success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => screen.getByLabelText(/6-digit code/i));
    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /^Verify$/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/otp/verify",
        expect.objectContaining({ method: "POST" })
      );
      expect(screen.getByText("This phone number is verified.")).toBeInTheDocument();
      expect(screen.getByText("0711234567")).toBeInTheDocument();
      expect(screen.getByText(/linked to this account/i)).toBeInTheDocument();
    });

    expect(mockPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Continue to dashboard/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
    });
  });

  it("shows the error under the code field and stays on the OTP step when verify returns 409", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: "in use" }),
    } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => screen.getByLabelText(/6-digit code/i));
    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /^Verify$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This phone number is already linked to another account.");
    const code = screen.getByLabelText(/6-digit code/i);
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "otp-error");
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    // Typing a new code clears the message.
    await user.type(code, "{backspace}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a refused send under the number, without a toast", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({
        error:
          "This phone number can't be used on VerifyMzansi. Contact support if you think this is a mistake.",
        code: "phone_banned",
      }),
    } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send code/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This phone number can't be used on VerifyMzansi.");
    const number = screen.getByLabelText(/SA mobile number/i);
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(number).toHaveAttribute("aria-describedby", "phone-error");
    expect(screen.queryByText(/Format: 0XX XXX XXXX/)).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
    await user.type(number, "8");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/Format: 0XX XXX XXXX/)).toBeInTheDocument();
  });

  it("waits out a rate limit: the message stays and Send code is disabled", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "840" }),
      json: async () => ({
        error: "Too many attempts. Try again in 14 minutes.",
        code: "rate_limited",
        retryAfter: 840,
      }),
    } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send code/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in 14 minutes."
    );
    expect(screen.getByRole("button", { name: /Send code/i })).toBeDisabled();
    // Editing the number does not hide a wait that is still running.
    await user.type(screen.getByLabelText(/SA mobile number/i), "{backspace}");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("returns to phone step when Change number is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send code/i }));

    await waitFor(() => screen.getByRole("button", { name: /Change number/i }));
    await user.click(screen.getByRole("button", { name: /Change number/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/SA mobile number/i)).toBeInTheDocument();
    });
  });
});
