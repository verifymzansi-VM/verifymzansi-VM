import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
}));

import { DesktopPageShell, isAdminPath } from "./desktop-page-shell";

describe("DesktopPageShell", () => {
  it("keeps desktop scaling enabled for public routes", () => {
    usePathnameMock.mockReturnValue("/mzansi-market");

    render(
      <DesktopPageShell>
        <div>Marketplace</div>
      </DesktopPageShell>
    );

    expect(screen.getByText("Marketplace").parentElement).toHaveClass("desktop-page-scale");
    expect(screen.getByText("Marketplace").parentElement).toHaveAttribute(
      "data-desktop-scale",
      "on"
    );
  });

  it("disables desktop scaling for admin routes", () => {
    usePathnameMock.mockReturnValue("/admin/moderation");

    render(
      <DesktopPageShell>
        <div>Moderation</div>
      </DesktopPageShell>
    );

    expect(screen.getByText("Moderation").parentElement).not.toHaveClass("desktop-page-scale");
    expect(screen.getByText("Moderation").parentElement).toHaveAttribute(
      "data-desktop-scale",
      "off"
    );
  });
});

describe("isAdminPath", () => {
  it("recognizes admin root and nested admin routes", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/moderation")).toBe(true);
    expect(isAdminPath("/admin/verification/queue")).toBe(true);
  });

  it("ignores non-admin routes", () => {
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/dashboard")).toBe(false);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath(null)).toBe(false);
  });
});
