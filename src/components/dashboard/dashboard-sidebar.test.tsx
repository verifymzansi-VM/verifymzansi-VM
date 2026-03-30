import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardSidebar } from "./dashboard-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/promotions",
}));

describe("DashboardSidebar", () => {
  it("labels the promotions area consistently", () => {
    render(<DashboardSidebar onSignOut={vi.fn()} />);

    expect(screen.getByRole("link", { name: /Promotions/i })).toHaveAttribute(
      "href",
      "/dashboard/promotions"
    );
  });
});
