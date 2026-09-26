import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardMobileNav } from "./dashboard-mobile-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/listings",
}));

describe("DashboardSidebar", () => {
  it("shows the My Posts link pointing to the unified listings page", () => {
    render(<DashboardSidebar onSignOut={vi.fn()} />);

    const link = screen.getByRole("link", { name: /My Posts/i });
    expect(link).toHaveAttribute("href", "/dashboard/listings");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("hides the verification progress card once the account is verified", () => {
    render(
      <DashboardSidebar
        onSignOut={vi.fn()}
        badges={{
          incompleteVerification: false,
          pendingReview: false,
          verificationProgress: { approved: 0, submitted: 0, total: 4 },
        }}
      />
    );

    expect(screen.queryByText(/Finish verification/i)).not.toBeInTheDocument();
  });

  it("shows verification progress while steps are outstanding", () => {
    render(
      <DashboardSidebar
        onSignOut={vi.fn()}
        badges={{
          incompleteVerification: true,
          verificationProgress: { approved: 1, submitted: 2, total: 4 },
        }}
      />
    );

    expect(screen.getByRole("link", { name: /Finish verification/i })).toHaveAttribute(
      "href",
      "/verification"
    );
    expect(screen.getByRole("progressbar", { name: /verification steps/i })).toHaveAttribute(
      "aria-valuenow",
      "2"
    );
  });

  it("labels unread lead counts for screen readers", () => {
    render(<DashboardSidebar onSignOut={vi.fn()} badges={{ unreadLeads: 3 }} />);

    expect(screen.getByRole("link", { name: /Leads.*3 new leads/i })).toHaveAttribute(
      "href",
      "/dashboard/leads"
    );
  });
});

describe("DashboardMobileNav", () => {
  it("keeps every dashboard section reachable on phones", () => {
    render(<DashboardMobileNav />);

    const nav = screen.getByRole("navigation", { name: "Dashboard sections" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /my posts/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /^leads/i })).toHaveAttribute(
      "href",
      "/dashboard/leads"
    );
    expect(screen.getByRole("link", { name: /profile and settings/i })).toHaveAttribute(
      "href",
      "/dashboard/profile"
    );
  });
});
