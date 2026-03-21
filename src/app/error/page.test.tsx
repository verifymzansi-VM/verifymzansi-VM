import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./page";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("App error page", () => {
  it("renders the recovery copy for account verification outages", async () => {
    render(await ErrorPage({ searchParams: Promise.resolve({ reason: "unavailable" }) }));

    expect(
      screen.getByRole("heading", { name: /service temporarily unavailable/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/couldn't verify your account details right now/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /retry from dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(screen.getByRole("link", { name: /go home/i })).toHaveAttribute("href", "/");
  });
});
