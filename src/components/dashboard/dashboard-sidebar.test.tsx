import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./dashboard-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/listings",
}));

describe("DashboardSidebar", () => {
  it("shows the My Posts link pointing to the unified listings page", () => {
    render(<DashboardSidebar onSignOut={vi.fn()} />);

    expect(screen.getByRole("link", { name: /My Posts/i })).toHaveAttribute(
      "href",
      "/dashboard/listings"
    );
  });
});
