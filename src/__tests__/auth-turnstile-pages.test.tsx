/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockPush, mockRefresh, mockToast, mockTurnstileRetry, turnstileLifecycle } = vi.hoisted(
  () => ({
    mockPush: vi.fn(),
    mockRefresh: vi.fn(),
    mockToast: vi.fn(),
    mockTurnstileRetry: vi.fn(),
    turnstileLifecycle: {
      mounts: 0,
      unmounts: 0,
      retryTokens: [] as number[],
    },
  })
);

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>{children}</label>
  ),
}));

vi.mock("@/components/ui/google-oauth-button", () => ({
  GoogleOAuthButton: ({ mode }: { mode: string }) => <div data-testid={`google-${mode}`} />,
}));

vi.mock("@/lib/turnstile-client", () => ({
  TURNSTILE_UNAVAILABLE_MESSAGE:
    "Security verification is temporarily unavailable. Please try again later.",
  getTurnstileClientState: () => ({ mode: "configured", siteKey: "test-site-key" }),
}));

vi.mock("@/lib/utils/navigation", () => ({
  sanitizeReturnUrl: () => "/",
}));

vi.mock("@/components/ui/turnstile-widget", () => {
  const MockTurnstileWidget = ({
    onSuccess,
    onError,
    retryToken,
  }: {
    onSuccess?: (token: string) => void;
    onError?: (message: string) => void;
    retryToken?: number;
  }) => {
    useEffect(() => {
      turnstileLifecycle.mounts += 1;
      return () => {
        turnstileLifecycle.unmounts += 1;
      };
    }, []);

    turnstileLifecycle.retryTokens.push(retryToken ?? 0);

    return (
      <div data-testid="mock-turnstile-widget" data-retry-token={String(retryToken ?? 0)}>
        <button type="button" onClick={() => onSuccess?.(`token-${retryToken ?? 0}`)}>
          Trigger Turnstile Success
        </button>
        <button type="button" onClick={() => onError?.("mock error")}>
          Trigger Turnstile Error
        </button>
      </div>
    );
  };

  return {
    TurnstileWidget: Object.assign(MockTurnstileWidget, {
      retry: mockTurnstileRetry,
    }),
  };
});

import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";

describe("auth page Turnstile retry behavior", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    mockToast.mockReset();
    mockTurnstileRetry.mockReset();
    turnstileLifecycle.mounts = 0;
    turnstileLifecycle.unmounts = 0;
    turnstileLifecycle.retryTokens = [];
    vi.stubGlobal("fetch", vi.fn());
    window.history.replaceState({}, "", "/login");
  });

  it("retries Turnstile on the login page without remounting the widget", async () => {
    render(<LoginPage />);

    expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "0");
    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Error" }));

    const retryButton = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "1");
    });

    expect(mockTurnstileRetry).toHaveBeenCalledTimes(1);
    expect(turnstileLifecycle.mounts).toBe(1);
    expect(turnstileLifecycle.unmounts).toBe(0);
  });

  it("retries Turnstile on the register page without remounting the widget", async () => {
    window.history.replaceState({}, "", "/register");
    render(<RegisterPage />);

    expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "0");
    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Error" }));

    const retryButton = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "1");
    });

    expect(mockTurnstileRetry).toHaveBeenCalledTimes(1);
    expect(turnstileLifecycle.mounts).toBe(1);
    expect(turnstileLifecycle.unmounts).toBe(0);
  });

  it("blocks login submit while Turnstile is in an error state", async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Error" }));

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
  });

  it("resets the login Turnstile challenge after a failed submit", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid email or password" }),
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Success" }));
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "1");
    });

    expect(mockTurnstileRetry).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Invalid email or password", variant: "destructive" })
    );
  });

  it("blocks register submit while Turnstile is in an error state", async () => {
    window.history.replaceState({}, "", "/register");
    render(<RegisterPage />);

    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Error" }));

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create account/i })).toBeDisabled();
  });

  it("resets the register Turnstile challenge after a failed submit", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Registration failed. Please try again." }),
    });

    window.history.replaceState({}, "", "/register");
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/surname/i), { target: { value: "User" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/sa mobile number/i), {
      target: { value: "0712345678" },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Password123" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: "Password123" },
    });
    fireEvent.click(screen.getByLabelText(/i agree to the/i));
    fireEvent.click(screen.getByRole("button", { name: "Trigger Turnstile Success" }));
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-turnstile-widget")).toHaveAttribute("data-retry-token", "1");
    });

    expect(mockTurnstileRetry).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Registration failed", variant: "destructive" })
    );
  });
});
