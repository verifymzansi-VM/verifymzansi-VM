import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileNav } from "./mobile-nav";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ isAuthenticated: false }) }));
vi.mock("@/components/video-mode/video-mode-entry", () => ({
  useOpenVideoMode: () => vi.fn(),
}));

describe("MobileNav", () => {
  it("offers Video mode in the second slot; Search lives in the header", () => {
    route.pathname = "/mzansi-market";
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: "Video" })).toHaveAttribute("href", "/video-mode");
    expect(screen.queryByRole("link", { name: "Search" })).not.toBeInTheDocument();
  });

  it("shows the same tabs on the home page", () => {
    route.pathname = "/";
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: "Video" })).toHaveAttribute("href", "/video-mode");
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
    route.pathname = "/";
    render(<MobileNav />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/login?returnUrl=%2Fdashboard"
    );
  });
});
