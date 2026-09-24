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
  it.each(["/search", "/dashboard", "/mzansi-market", "/tourism-events", "/verification"])(
    "hides the bar on %s",
    (pathname) => {
      route.pathname = pathname;
      render(<MobileNav />);
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    }
  );
});
