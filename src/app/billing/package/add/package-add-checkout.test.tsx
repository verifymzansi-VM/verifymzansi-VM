import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageAddCheckout, type PackageAddOffer } from "./package-add-checkout";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/shared/brand-logo", () => ({ BrandLogo: () => null }));

const packageId = "11111111-2222-4333-8444-555555555555";
/** 25 slots, 38 whole days left: one added slot costs R126.67. */
const offer = (overrides: Partial<PackageAddOffer> = {}): PackageAddOffer => ({
  packageId,
  places: 25,
  endsAt: "2026-12-24T08:00:00Z",
  daysLeft: 38,
  unitPriceCents: 12667,
  maxSlots: 225,
  onlineOpen: true,
  invoiceOpen: true,
  invoiceUnpaid: false,
  requestOpen: null,
  ...overrides,
});
const total = () => screen.getByTestId("package-add-total").textContent?.replace(/\s/g, " ");
const box = () => screen.getByTestId("package-add-slots") as HTMLInputElement;

describe("PackageAddCheckout (P4b)", () => {
  const originalLocation = window.location;
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign: vi.fn(), origin: "http://localhost" },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    vi.unstubAllGlobals();
  });

  it("prices the slots for the days left and shows the new total of slots", () => {
    render(<PackageAddCheckout offer={offer()} onlineMaxCents={130_000} initialSlots={5} />);
    expect(screen.getByText("Multi-listing · 25 slots")).toBeInTheDocument();
    expect(total()).toBe("R633.35");
    expect(screen.getByText("5 slots × 38 days at R100 per 30 days")).toBeInTheDocument();
    expect(screen.getByTestId("package-add-slots-help")).toHaveTextContent("25 → 30 slots");
    expect(screen.getByText("With your package, 24 December 2026")).toBeInTheDocument();
    expect(screen.getByText("38 (whole days left today)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "One slot more" }));
    expect(box().value).toBe("6");
    expect(total()).toBe("R760.02");
  });

  it("pays online once the box is ticked, with the total shown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: "https://pay.ozow.com/x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PackageAddCheckout offer={offer()} onlineMaxCents={130_000} initialSlots={5} />);
    const pay = screen.getByRole("button", { name: "Pay R633.35 securely" });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(pay);
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith("https://pay.ozow.com/x")
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/billing/package-add-checkout");
    expect(JSON.parse(init.body)).toEqual({
      packageId,
      slots: 5,
      expectedTotalCents: 63335,
      coolingOffConsent: true,
    });
  });

  it("asks for an invoice above Ozow's maximum, with the price fixed now", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PackageAddCheckout offer={offer()} onlineMaxCents={130_000} initialSlots={20} />);
    expect(total()).toBe("R2 533.40");
    expect(screen.getByTestId("package-add-invoice")).toHaveTextContent(
      "we send an invoice. Pay it by bank transfer within 3 days."
    );
    expect(screen.getByText("Fixed now, even if it clears later")).toBeInTheDocument();
    expect(screen.getByText("When your payment clears")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull();
    const ask = screen.getByRole("button", { name: "Ask for an invoice" });
    expect(ask).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(ask);
    await waitFor(() =>
      expect(screen.getByTestId("package-add-invoice")).toHaveTextContent(
        "Invoice requested for 20 slots (R2 533.40)."
      )
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/billing/package-add-invoice");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ packageId, slots: 20, expectedTotalCents: 253340 });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("says when the invoice route is closed (fewer than 10 days) and the total is above the limit", () => {
    render(
      <PackageAddCheckout
        offer={offer({ daysLeft: 8, unitPriceCents: 2667, invoiceOpen: false })}
        onlineMaxCents={130_000}
        initialSlots={60}
      />
    );
    expect(screen.getByTestId("package-add-slots-help")).toHaveTextContent(
      "slots are added by invoice while 10 or more days are left. Add fewer slots."
    );
    expect(screen.getByRole("button", { name: /^Pay/ })).toBeDisabled();
  });

  it("shows the too-late screen with fewer than 7 days left", () => {
    render(
      <PackageAddCheckout
        offer={offer({ daysLeft: 6, onlineOpen: false, invoiceOpen: false })}
        block="too_late"
      />
    );
    expect(screen.getByTestId("package-add-too-late")).toHaveTextContent(
      "6 days left. Slots can be added while 7 or more days are left."
    );
    expect(screen.getByRole("link", { name: "Back to My slots" })).toHaveAttribute(
      "href",
      "/dashboard/slots"
    );
  });

  it("asks for the ID review, and says when there is no running package", () => {
    const { unmount } = render(<PackageAddCheckout offer={offer()} block="id_review" />);
    expect(screen.getByTestId("package-add-block-id_review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull();
    unmount();
    render(<PackageAddCheckout offer={null} block="no_package" />);
    expect(screen.getByTestId("package-add-block-no_package")).toHaveTextContent(
      "Slots are added to a running Multi-listing package. You have none now."
    );
  });

  it("sends an unpaid package invoice to Invoices first", () => {
    render(<PackageAddCheckout offer={offer({ invoiceUnpaid: true })} initialSlots={2} />);
    expect(screen.getByTestId("package-add-invoice-unpaid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull();
  });
});
