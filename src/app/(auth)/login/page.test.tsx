import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const pushMock = vi.fn();
const toastMock = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/ui/google-oauth-button", () => ({
  GoogleOAuthButton: ({ mode }: { mode: string }) => <div data-testid={`google-oauth-${mode}`} />,
}));

vi.mock("@/components/ui/turnstile-widget", async () => {
  const { useEffect } = await import("react");
  return {
    TurnstileWidget: ({ onSuccess }: { onSuccess?: (token: string) => void }) => {
      useEffect(() => {
        onSuccess?.("test-turnstile-token");
      }, [onSuccess]);
      return <div data-testid="turnstile-widget" />;
    },
  };
});

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/login");
  });

  it("shows the post-registration email confirmation banner", async () => {
    window.history.pushState({}, "", "/login?registered=true");

    render(<LoginPage />);

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText(/We've sent a confirmation link/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Resend confirmation$/i })).toBeInTheDocument();
  });

  it("shows the email confirmed banner when redirected from confirmation", async () => {
    window.history.pushState({}, "", "/login?confirmed=true");

    render(<LoginPage />);

    expect(await screen.findByText("Email confirmed!")).toBeInTheDocument();
    expect(
      screen.getByText(/Your email address has been verified\. You can now sign in/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Sign in to your account/i })).toBeInTheDocument();
  });

  it("does not show the resend confirmation section for plain login visitors", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Sign in to your account/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/Need a new confirmation email\?/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Resend confirmation$/i })
    ).not.toBeInTheDocument();
  });

  it("enables the email and password fields after hydration", async () => {
    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeEnabled();
      expect(screen.getByLabelText("Password")).toBeEnabled();
    });
  });

  it("shows the resend-confirmation prompt when the API returns email_not_confirmed", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/csrf")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "c".repeat(64) }), { status: 200 })
        );
      }
      if (url.includes("/api/auth/login")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "Please confirm your email address before signing in.",
              code: "email_not_confirmed",
            }),
            { status: 403 }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "unconfirmed@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "CorrectPass1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Resend confirmation$/i })).toBeInTheDocument();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Please confirm your email address before signing in.",
        variant: "destructive",
      })
    );

    vi.unstubAllGlobals();
  });
});
