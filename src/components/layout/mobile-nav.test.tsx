import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileNav } from "./mobile-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAuthenticated: false }) }));

describe("MobileNav", () => {
  it("replaces Safety with Search on the home page", () => {
    route.pathname = "/";
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    expect(screen.queryByRole("link", { name: "Safety" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post" })).toHaveAttribute(
      "href",
      "/login?returnUrl=%2Fpost%2Fcreate"
    );
  });
  it.each(["/search", "/mzansi-market", "/mzansi-business", "/tourism-events", "/safety"])(
    "shows the app tab bar on discovery page %s",
    (pathname) => {
      route.pathname = pathname;
      render(<MobileNav />);
      expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    }
  );

  it.each([
    "/dashboard",
    "/verification",
    "/listing/abc",
    "/mzansi-business/abc",
    "/tourism-events/abc",
    "/post/create",
    "/login",
  ])("hides the bar on %s, which has its own sticky actions or chrome", (pathname) => {
    route.pathname = pathname;
    render(<MobileNav />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("marks the active tab and labels the account tab", () => {
    route.pathname = "/search";
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/login?returnUrl=%2Fdashboard"
    );
  });
});
