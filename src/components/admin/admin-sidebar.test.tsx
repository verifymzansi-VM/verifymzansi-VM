import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navFor } from "@/lib/admin/nav";
import { AdminMobileNav, AdminSidebar } from "./admin-sidebar";

const { pathname } = vi.hoisted(() => ({ pathname: { current: "/admin" } }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("AdminSidebar", () => {
  beforeEach(() => {
    pathname.current = "/admin";
  });

  it("shows the registry's pages for the role, with waiting counts", () => {
    render(<AdminSidebar sections={navFor("moderator")} counts={{ reports: 12, kyc: 0 }} />);

    expect(screen.getByRole("link", { name: "My shift" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Reports, 12 waiting" })).toBeInTheDocument();
    // No badge for an empty queue.
    expect(screen.getByRole("link", { name: "Verify accounts" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Escalations/ })).not.toBeInTheDocument();
  });

  it("marks only the most specific page as current", () => {
    pathname.current = "/admin/verification/evidence";
    render(<AdminSidebar sections={navFor("admin", { kyc_evidence_desk: true })} counts={{}} />);

    expect(screen.getByRole("link", { name: "Evidence desk" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Verify accounts" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("link", { name: "Platform" })).not.toHaveAttribute("aria-current");
  });

  it("collapses to icons with accessible names", () => {
    render(<AdminSidebar sections={navFor("governance_controller")} counts={{ appeals: 2 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));

    expect(screen.getByRole("button", { name: "Expand menu" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.getByRole("link", { name: "Appeals, 2 waiting" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Data requests" })).toBeInTheDocument();
  });
});

describe("AdminMobileNav", () => {
  it("says how much is waiting and opens the same menu", () => {
    render(<AdminMobileNav sections={navFor("moderator")} counts={{ reports: 2, content: 1 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Open admin menu, 3 items waiting" }));

    expect(screen.getByRole("link", { name: "Reports, 2 waiting" })).toBeInTheDocument();
  });
});
