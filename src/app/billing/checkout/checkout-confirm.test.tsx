import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutConfirm, type CheckoutSummary } from "./checkout-confirm";
import { formatPlanPrice } from "@/lib/constants/pricing";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/shared/brand-logo", () => ({ BrandLogo: () => null }));

const summary: CheckoutSummary = {
  planId: "11111111-2222-4333-8444-555555555555",
  name: "Market 30 days",
  areaLabel: "Mzansi Market",
  priceCents: 9900,
  durationDays: 30,
  durationLabel: "30 days",
  slotCapacity: 1,
  monthlyActivationLimit: null,
};

describe("CheckoutConfirm", () => {
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

  it("says paid slots open soon, with nothing to pay, while no plan is on sale", () => {
    render(<CheckoutConfirm summary={null} paused />);
    expect(
      screen.getByText("Paid slots open soon. Until then, your first post and events are free.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay .* securely/ })).toBeNull();
  });

  it("calls an unknown plan not available while plans are on sale", () => {
    render(<CheckoutConfirm summary={null} />);
    expect(screen.getByText(/This plan is not available/)).toBeInTheDocument();
  });

  it("offers a sign-in link back to this plan when the session expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    );
    render(<CheckoutConfirm summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay .* securely/ }));

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute(
      "href",
      `/login?returnUrl=${encodeURIComponent(`/billing/checkout?plan=${summary.planId}`)}`
    );
    expect(screen.getByRole("button", { name: /Pay .* securely/ })).toBeEnabled();
  });

  it("re-enables payment when the page is restored from the back/forward cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ checkoutUrl: "https://pay.ozow.com/x" }), { status: 200 })
      )
    );
    render(<CheckoutConfirm summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay .* securely/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Redirecting to Ozow/ })).toBeDisabled()
    );

    await act(async () => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });

    expect(screen.getByRole("button", { name: /Pay .* securely/ })).toBeEnabled();
  });
});

describe("CheckoutConfirm for Individual slots", () => {
  const terms = [
    {
      planId: "11111111-2222-4333-8444-000000000030",
      label: "Individual slot — 30 days",
      durationDays: 30,
      priceCents: 6900,
    },
    {
      planId: "11111111-2222-4333-8444-000000000090",
      label: "Individual slot — 90 days",
      durationDays: 90,
      priceCents: 20700,
    },
    {
      planId: "11111111-2222-4333-8444-000000000180",
      label: "Individual slot — 180 days",
      durationDays: 180,
      priceCents: 41400,
    },
  ];
  const slotSummary = (overrides: Partial<CheckoutSummary> = {}): CheckoutSummary => ({
    planId: terms[0].planId,
    name: terms[0].label,
    areaLabel: "Market, Business or Tourism",
    priceCents: 6900,
    durationDays: 30,
    durationLabel: "30 days",
    slotCapacity: 1,
    monthlyActivationLimit: 4,
    slotTerms: terms,
    slotStatus: { verified: true, held: 0, pending: 0, limit: 4 },
    ...overrides,
  });
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
  const total = () => screen.getByTestId("checkout-total").textContent;
  const payButton = () => screen.getByRole("button", { name: /Pay .* securely/ });

  it("prices slot price x slots for the chosen days, and pays only with the consent", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ checkoutUrl: "https://pay.ozow.com/x" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    render(<CheckoutConfirm summary={slotSummary()} />);
    // 30 days is preselected.
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    expect(total()).toBe("R69");
    fireEvent.click(screen.getByRole("radio", { name: "90 days" }));
    expect(total()).toBe("R207");
    fireEvent.click(screen.getByRole("button", { name: "One slot more" }));
    expect(total()).toBe("R414");
    expect(screen.getByText("R207 × 2 slots")).toBeInTheDocument();
    expect(payButton()).toHaveAccessibleName("Pay R414 securely");
    // No tick, no payment.
    expect(payButton()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /My slot starts now; the 7-day cooling-off does not apply/,
      })
    );
    expect(payButton()).toBeEnabled();
    fireEvent.click(payButton());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      planId: terms[1].planId,
      slots: 2,
      expectedTotalCents: 41400,
      coolingOffConsent: true,
    });
  });

  it("starts on the days the link chose", () => {
    render(<CheckoutConfirm summary={slotSummary({ planId: terms[2].planId })} />);
    expect(screen.getByRole("radio", { name: "180 days" })).toBeChecked();
    expect(total()).toBe("R414");
  });

  it("offers no more slots than the member may still buy", () => {
    render(
      <CheckoutConfirm
        summary={slotSummary({ slotStatus: { verified: true, held: 2, pending: 1, limit: 4 } })}
      />
    );
    expect(screen.getByRole("button", { name: "One slot more" })).toBeDisabled();
    expect(screen.getByTestId("checkout-slots")).toHaveTextContent("1");
  });

  it("explains, without a pay step, why a member without an accepted ID review cannot buy", () => {
    render(
      <CheckoutConfirm
        summary={slotSummary({ slotStatus: { verified: false, held: 0, pending: 0, limit: 4 } })}
      />
    );
    expect(screen.getByTestId("slot-block-id_review")).toHaveTextContent(
      "Your ID review must be accepted before you buy a slot"
    );
    expect(screen.getByRole("link", { name: "Go to my ID review" })).toHaveAttribute(
      "href",
      "/verification"
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(payButton()).toBeDisabled();
  });

  it("lets a member with a payment still open come back to it", () => {
    render(
      <CheckoutConfirm
        summary={slotSummary({ slotStatus: { verified: true, held: 3, pending: 1, limit: 4 } })}
      />
    );
    expect(screen.queryByTestId("slot-block-limit")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /^My slot starts now/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "One slot more" })).toBeDisabled();
  });

  it("explains the limit when every slot is taken", () => {
    render(
      <CheckoutConfirm
        summary={slotSummary({ slotStatus: { verified: true, held: 4, pending: 0, limit: 4 } })}
      />
    );
    expect(screen.getByTestId("slot-block-limit")).toHaveTextContent(
      "You can hold 4 Individual slots at a time."
    );
    expect(screen.getByRole("link", { name: "My slots" })).toHaveAttribute(
      "href",
      "/dashboard/slots"
    );
    expect(payButton()).toBeDisabled();
  });

  it("sends orders above R10,000 to an invoice, and R10,000 exactly stays online", () => {
    const priced = (priceCents: number) =>
      slotSummary({
        slotTerms: [{ ...terms[0], priceCents }],
        slotStatus: { verified: true, held: 0, pending: 0, limit: 25 },
      });
    const { unmount } = render(<CheckoutConfirm summary={priced(500_000)} />);
    fireEvent.click(screen.getByRole("button", { name: "One slot more" }));
    expect(total()).toBe(formatPlanPrice(1_000_000));
    expect(screen.queryByTestId("slot-block-invoice")).toBeNull();
    unmount();
    render(<CheckoutConfirm summary={priced(500_100)} />);
    fireEvent.click(screen.getByRole("button", { name: "One slot more" }));
    expect(screen.getByTestId("slot-block-invoice")).toHaveTextContent(
      "Orders above R10,000 are paid by invoice."
    );
    expect(screen.getByRole("link", { name: "Ask for an invoice" })).toHaveAttribute(
      "href",
      "mailto:billing@verifymzansi.com?subject=Invoice%20for%20slots"
    );
    expect(payButton()).toBeDisabled();
  });
});
