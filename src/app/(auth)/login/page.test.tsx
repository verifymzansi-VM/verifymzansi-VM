import { render, screen } from "@testing-library/react";
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

vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

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
    expect(screen.getByRole("button", { name: /Didn't receive it\? Resend/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Resend confirmation email$/i })
    ).toBeInTheDocument();
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

  it("shows a neutral resend confirmation section for returning users", async () => {
    render(<LoginPage />);

    expect(await screen.findByText(/Need a new confirmation email\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(/If your account is still waiting for email confirmation/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Resend confirmation email$/i })
    ).toBeInTheDocument();
  });
});
