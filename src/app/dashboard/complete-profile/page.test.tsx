import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CompleteProfilePage from "./page";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";

const mockPush = vi.fn();
const mockFetch = vi.fn();
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();
const mockToast = vi.fn();
const mockFrom = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/utils/csrf", () => ({
  withCsrfHeaders: (h: Record<string, string>) => h,
}));

vi.mock("@/lib/utils/format", () => ({
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
    global.fetch = mockFetch;
  });

  it("renders verify-phone onboarding copy", async () => {
    render(<CompleteProfilePage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Verify Your Phone Number" })
      ).toBeInTheDocument();
    });

    expect(screen.getByText("Verify your phone number before you continue.")).toBeInTheDocument();
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

  it("pre-fills phone input from pending_phone", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: "Nomsa", phone: null, pending_phone: "+27711234567" },
      error: null,
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

    const sendBtn = screen.getByRole("button", { name: /Send Verification Code/i });
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
    await user.click(screen.getByRole("button", { name: /Send Verification Code/i }));

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

  it("shows error toast and stays on OTP step when verify returns 409", async () => {
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
    await user.click(screen.getByRole("button", { name: /Send Verification Code/i }));

    await waitFor(() => screen.getByLabelText(/6-digit code/i));
    await user.type(screen.getByLabelText(/6-digit code/i), "123456");
    await user.click(screen.getByRole("button", { name: /^Verify$/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Phone number already in use" })
      );
    });
    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
  });

  it("returns to phone step when Change number is clicked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as Response);

    render(<CompleteProfilePage />);

    await waitFor(() => screen.getByLabelText(/SA mobile number/i));
    await user.type(screen.getByLabelText(/SA mobile number/i), "0711234567");
    await user.click(screen.getByRole("button", { name: /Send Verification Code/i }));

    await waitFor(() => screen.getByRole("button", { name: /Change number/i }));
    await user.click(screen.getByRole("button", { name: /Change number/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/SA mobile number/i)).toBeInTheDocument();
    });
  });
});
