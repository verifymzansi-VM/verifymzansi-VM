import { render, screen } from "@testing-library/react";
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
});
