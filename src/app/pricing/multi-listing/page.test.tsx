import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MultiListingPage from "./page";
import { notFound } from "next/navigation";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/foundation/slot-package-offer", () => ({ readPackagesOnSale: vi.fn() }));
vi.mock("@/lib/foundation/payment-limits", () => ({
  readOnlinePaymentMaxCents: vi.fn(async () => 130000),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/components/layout/breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/brand", () => ({
  BrandSurface: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

describe("the hidden Multi-listing page (P4a)", () => {
  beforeEach(() => vi.mocked(readPackagesOnSale).mockReset());

  it("stays hidden while packages are not on sale", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue(null);
    await expect(MultiListingPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("states the new rules once on sale, and none of the old ones", async () => {
    vi.mocked(readPackagesOnSale).mockResolvedValue({ on_sale: true, plans: [{}] } as never);
    const { container } = render(await MultiListingPage());
    const text = container.textContent ?? "";
    expect(text).toMatch(/From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days/);
    expect(screen.getByText("Does not renew automatically")).toBeInTheDocument();
    // Package teams are shown (SHOW_PACKAGE_TEAMS), though not built yet.
    expect(text).toMatch(/You \+ 1 person \(you \+ 4 from 50 slots\)/);
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
