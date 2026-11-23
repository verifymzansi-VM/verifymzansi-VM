import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PackageCheckout } from "./package-checkout";
import { formatPlanPrice } from "@/lib/constants/pricing";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/shared/brand-logo", () => ({ BrandLogo: () => null }));

const terms = [
  { planId: "11111111-2222-4333-8444-555555555530", days: 30 as const },
  { planId: "11111111-2222-4333-8444-555555555590", days: 90 as const },
  { planId: "11111111-2222-4333-8444-555555555518", days: 180 as const },
];
const total = () => screen.getByTestId("package-total").textContent?.replace(/\s/g, " ");
const box = () => screen.getByTestId("package-slots") as HTMLInputElement;
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const payButton = () => screen.getByRole("button", { name: /^Pay/ });

describe("PackageCheckout (P4a)", () => {
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

  it("prices the typed number of slots for the chosen term", () => {
    render(
      <PackageCheckout
        terms={terms}
        initialSlots={25}
        initialDays={90}
        onlineMaxCents={1_000_000}
      />
    );
    expect(total()).toBe("R7 500");
    expect(screen.getByText("Up to 33 slots for 90 days can be paid online.")).toBeInTheDocument();
    type("10");
    expect(total()).toBe("R3 000");
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    expect(total()).toBe("R1 000");
    fireEvent.click(screen.getByRole("button", { name: "50" }));
    expect(box().value).toBe("50");
    expect(total()).toBe("R5 000");
    fireEvent.click(screen.getByRole("button", { name: "One slot more" }));
    expect(box().value).toBe("51");
  });

  it("starts at 5 slots: fewer has no total and cannot be paid", () => {
    render(<PackageCheckout terms={terms} initialSlots={5} initialDays={30} />);
    expect(screen.getByRole("button", { name: "One slot fewer" })).toBeDisabled();
    type("4");
    expect(total()).toBe("—");
    expect(
      screen.getByText("Packages start at 5 slots. For 1-4, use Individual slots (R69).")
    ).toBeInTheDocument();
    expect(payButton()).toBeDisabled();
    type("");
    expect(payButton()).toBeDisabled();
  });

  it("sends a total above Ozow's maximum to an invoice instead of a payment", () => {
    render(
      <PackageCheckout terms={terms} initialSlots={34} initialDays={90} onlineMaxCents={130_000} />
    );
    expect(total()).toBe("R10 200");
    expect(screen.getByTestId("package-invoice").textContent).toContain(
      `Ozow takes payments of up to ${formatPlanPrice(130_000)}, so this package is paid by invoice, at the same price.`
    );
    expect(screen.getByText("A package for 90 days is paid by invoice.")).toBeInTheDocument();
    expect(screen.getByText("When your invoice is paid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask for an invoice" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Pay/ })).toBeNull();
    type("101");
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    expect(screen.getByTestId("package-invoice")).toBeInTheDocument();
  });

  it("asks for an invoice only after the invoice's own tick, once per order", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, request: { status: "requested" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const uuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-2222-4333-8444-5555555555aa");
    onTestFinished(() => uuid.mockRestore());
    render(
      <PackageCheckout terms={terms} initialSlots={50} initialDays={90} onlineMaxCents={130_000} />
    );
    const ask = () => screen.getByRole("button", { name: "Ask for an invoice" });
    expect(ask()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /My slots start as soon as this invoice/ })
    );
    fireEvent.click(ask());
    expect(await screen.findByText(/Invoice requested\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute(
      "href",
      "/billing/invoices"
    );
    expect(screen.queryByRole("button", { name: "Ask for an invoice" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/billing/package-invoice",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      planId: terms[1].planId,
      slots: 50,
      expectedTotalCents: 1_500_000,
      coolingOffConsent: true,
      requestId: "11111111-2222-4333-8444-5555555555aa",
    });
    // Another order asks again, with its own tick.
    type("60");
    expect(ask()).toBeDisabled();
    expect(
      screen.getByRole("checkbox", { name: /My slots start as soon as this invoice/ })
    ).not.toBeChecked();
  });

  it("shows the database's refusal of an invoice request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: "This account already has a Multi-listing package." }),
      }))
    );
    render(
      <PackageCheckout terms={terms} initialSlots={50} initialDays={90} onlineMaxCents={130_000} />
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /My slots start as soon as this invoice/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask for an invoice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account already has a Multi-listing package."
    );
    expect(screen.getByRole("button", { name: "Ask for an invoice" })).toBeEnabled();
  });

  it("while packages are not on sale: three terms, no plan, and the route's refusal", async () => {
    const offSale = [30, 90, 180].map((days) => ({ planId: null, days: days as 30 | 90 | 180 }));
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Multi-listing packages are not on sale yet." }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <PackageCheckout
        terms={offSale}
        initialSlots={25}
        initialDays={90}
        onlineMaxCents={130_000}
      />
    );
    // "Ask for an invoice" says so on the page and calls no route.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /My slots start as soon as this invoice/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask for an invoice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Multi-listing packages are not on sale yet."
    );
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
    // "Pay" calls the checkout route, which refuses.
    render(<PackageCheckout terms={offSale} initialSlots={5} initialDays={30} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /My slots start now/ }));
    fireEvent.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Multi-listing packages are not on sale yet."
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ planId: null, slots: 5 });
  });

  it("pays only after the 'my slots start now' tick, with the total shown", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ checkoutUrl: "https://one.ozow.com/checkout/synthetic" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PackageCheckout terms={terms} initialSlots={25} initialDays={90} />);
    expect(payButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /My slots start now/ }));
    expect(payButton()).toHaveTextContent("Pay R7 500 securely");
    fireEvent.click(payButton());
    await waitFor(() => expect(window.location.assign).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/billing/package-checkout",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      planId: terms[1].planId,
      slots: 25,
      expectedTotalCents: 750000,
      coolingOffConsent: true,
    });
  });

  it("changing the number or the term asks for the tick again", () => {
    render(<PackageCheckout terms={terms} initialSlots={25} initialDays={30} />);
    const tick = () => screen.getByRole("checkbox", { name: /My slots start now/ });
    fireEvent.click(tick());
    expect(tick()).toBeChecked();
    type("26");
    expect(tick()).not.toBeChecked();
  });

  it("shows the database's refusal and an unpaid package to continue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({
          error: "You already have a pending payment.",
          code: "PENDING_PAYMENT_EXISTS",
          pendingPayment: {
            id: "11111111-2222-4333-8444-555555555599",
            checkoutUrl: "https://one.ozow.com/checkout/open",
            statusUrl: "/billing/success?payment=x",
            canCancel: true,
            slots: 10,
            amountCents: 100000,
            package: true,
          },
        }),
      }))
    );
    render(<PackageCheckout terms={terms} initialSlots={25} initialDays={30} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /My slots start now/ }));
    fireEvent.click(payButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have a pending payment."
    );
    expect(screen.getByTestId("unpaid-order")).toHaveTextContent(
      "Unpaid package: 10 slots, R1 000"
    );
    expect(screen.getByRole("link", { name: "Continue payment" })).toBeInTheDocument();
  });

  it.each([
    ["id_review", /ID review must be accepted/, "/verification"],
    ["has_package", /already have a Multi-listing package/, "/dashboard/slots"],
  ] as const)("explains why the member cannot buy (%s)", (block, message, href) => {
    render(<PackageCheckout terms={terms} block={block} />);
    expect(screen.getByTestId(`package-block-${block}`)).toHaveTextContent(message);
    expect(screen.getByTestId(`package-block-${block}`).querySelector("a")).toHaveAttribute(
      "href",
      href
    );
    expect(payButton()).toBeDisabled();
  });

  it("tells a member with unpaid Individual slot invoices that a bank transfer still delivers them (D6)", () => {
    const { rerender } = render(
      <PackageCheckout terms={terms} unpaidInvoices={["VM-2026-000187"]} />
    );
    expect(screen.getByTestId("package-unpaid-invoices")).toHaveTextContent(
      "You have an unpaid invoice for Individual slots (VM-2026-000187). If you pay by bank transfer after your package starts, those slots run beside the package until their own end. See Invoices."
    );
    expect(screen.getByTestId("package-unpaid-invoices").querySelector("a")).toHaveAttribute(
      "href",
      "/billing/invoices"
    );
    rerender(
      <PackageCheckout terms={terms} unpaidInvoices={["VM-2026-000187", "VM-2026-000190"]} />
    );
    expect(screen.getByTestId("package-unpaid-invoices")).toHaveTextContent(
      "You have 2 unpaid invoices for Individual slots (VM-2026-000187, VM-2026-000190)."
    );
    // Not while the member cannot buy, and not without unpaid invoices.
    rerender(
      <PackageCheckout terms={terms} block="has_package" unpaidInvoices={["VM-2026-000187"]} />
    );
    expect(screen.queryByTestId("package-unpaid-invoices")).not.toBeInTheDocument();
    rerender(<PackageCheckout terms={terms} />);
    expect(screen.queryByTestId("package-unpaid-invoices")).not.toBeInTheDocument();
  });
});
