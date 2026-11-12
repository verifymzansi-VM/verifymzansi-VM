import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "./page";

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: false, isLoading: false },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/layout/header", () => ({ Header: () => <header /> }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => <footer /> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => authState }));

async function renderPage(reason?: string) {
  render(await ErrorPage({ searchParams: Promise.resolve({ reason }) }));
}

describe("App error page", () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.isLoading = false;
  });

  it("renders the recovery copy for account verification outages", async () => {
    authState.isAuthenticated = true;
    await renderPage("unavailable");

    expect(
      screen.getByRole("heading", { name: /service temporarily unavailable/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/couldn't verify your account details right now/i)).toBeInTheDocument();
  });

  it("sends a signed-in member to the dashboard first, with the homepage as the second way out", async () => {
    authState.isAuthenticated = true;
    await renderPage();

    const links = screen.getAllByRole("link").filter((link) => /^Go to /.test(link.textContent!));
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Go to dashboard", "/dashboard"],
      ["Go to homepage", "/"],
    ]);
  });

  it("offers a signed-out visitor the homepage, not the dashboard's sign-in page", async () => {
    await renderPage("unavailable");

    expect(screen.getByRole("link", { name: /go to homepage/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /go to dashboard/i })).toBeNull();
  });
});
