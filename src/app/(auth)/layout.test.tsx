import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AuthLayout from "./layout";

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

vi.mock("@/components/shared/brand-logo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

describe("AuthLayout", () => {
  it("renders a CSP-safe auth shell with a main landmark target", () => {
    const { container } = render(
      <AuthLayout>
        <div>Sign in form</div>
      </AuthLayout>
    );

    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(container.querySelector(".grain-overlay")).toBeNull();
    expect(screen.getByText("Sign in form")).toBeInTheDocument();
  });

  it("puts the form before the brand panel so keyboard users reach it first", () => {
    render(
      <AuthLayout>
        <div>Sign in form</div>
      </AuthLayout>
    );

    const main = screen.getByRole("main");
    const panel = screen.getByRole("complementary", { name: /people who've been checked/i });
    expect(main.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the brand panel short: one headline and three trust points", () => {
    render(
      <AuthLayout>
        <div>Sign in form</div>
      </AuthLayout>
    );

    const panel = screen.getByRole("complementary");
    expect(within(panel).getAllByRole("listitem")).toHaveLength(3);
    expect(within(panel).getByText(/phone and id checked/i)).toBeInTheDocument();
    // The panel must never contain a second "sign in" heading or button: e2e
    // specs rely on those names being unique on the page.
    expect(screen.queryByRole("heading", { name: /sign in|create your account/i })).toBeNull();
  });
});
