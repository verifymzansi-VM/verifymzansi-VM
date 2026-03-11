import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";

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
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/ui/google-oauth-button", () => ({
  GoogleOAuthButton: ({ mode }: { mode: string }) => <div data-testid={`google-oauth-${mode}`} />,
}));

vi.mock("@/components/ui/turnstile-widget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the registration heading expected by the auth QA flow", () => {
    render(<RegisterPage />);

    expect(screen.getByRole("heading", { name: /Create your account/i })).toBeInTheDocument();
    expect(screen.getByTestId("google-oauth-register")).toBeInTheDocument();
    expect(screen.getByTestId("turnstile-widget")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/i })).toHaveAttribute("href", "/login");
  });
});
