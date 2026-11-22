import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MultiListingPage from "./page";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/foundation/payment-limits", () => ({
  readOnlinePaymentMaxCents: vi.fn(async () => 130000),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/components/layout/breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/brand", () => ({
  BrandSurface: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

describe("the Multi-listing page (P4a)", () => {
  beforeEach(() => vi.mocked(readOnlinePaymentMaxCents).mockClear());

  it("is always shown: no visible link leads to a 404 (launch checklist item 71)", async () => {
    const { container } = render(await MultiListingPage());
    expect(container.textContent).toMatch(/Keep your whole stock live/);
    expect(screen.getAllByRole("link", { name: /Choose/ }).length).toBeGreaterThan(0);
  });

  it("states the new rules, and none of the old ones", async () => {
    const { container } = render(await MultiListingPage());
    const text = container.textContent ?? "";
    expect(text).toMatch(/From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days/);
    expect(screen.getByText("Does not renew automatically")).toBeInTheDocument();
    // Package teams are not built yet (SHOW_PACKAGE_TEAMS is off).
    expect(text).not.toMatch(/You \+ 1 person|you \+ 4/);
    // Advertise shows its Multi-listing section (PACKAGES_ON_SALE).
    expect(screen.getByRole("link", { name: /Who multi-listing is for/ })).toHaveAttribute(
      "href",
      "/advertise#multi-listing"
    );
    expect(text).toMatch(/up to 4 posts going live per slot per 30 days/);
    expect(text).not.toMatch(/Paid once|never renews|administrators|10 to 100|for 90 or 180 days/);
    // Ozow's maximum (the database setting), never the old R10,000.
    expect(text).toMatch(/Up to 100 slots and R1.300 are paid online/);
    expect(text).toMatch(/above the most Ozow accepts in one payment, by invoice/);
    expect(text).not.toMatch(/R10,000|above R10/);
  });
});
