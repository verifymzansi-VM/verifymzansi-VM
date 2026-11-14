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

  it("names the unpaid order the member is asked to continue or cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "You already have a pending payment.",
              code: "PENDING_PAYMENT_EXISTS",
              pendingPayment: {
                id: "11111111-2222-4333-8444-999999999999",
                checkoutUrl: "https://pay.ozow.com/x",
                statusUrl: "/billing/success",
                canCancel: true,
                slots: 3,
                amountCents: 20700,
              },
            }),
            { status: 409 }
          )
      )
    );
    render(<CheckoutConfirm summary={slotSummary()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^My slot starts now/ }));
    fireEvent.click(payButton());
    expect(await screen.findByTestId("unpaid-order")).toHaveTextContent(
      `Unpaid order: 3 slots, ${formatPlanPrice(20700)}`
    );
    expect(screen.getByRole("link", { name: "Continue payment" })).toHaveAttribute(
      "href",
      "https://pay.ozow.com/x"
    );
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

describe("CheckoutConfirm renewing slots early (P3)", () => {
  const term = {
    planId: "11111111-2222-4333-8444-000000000030",
    label: "Individual slot — 30 days",
    durationDays: 30,
    priceCents: 6900,
  };
  const slotA = "00000000-0000-4000-8000-0000000000a1";
  const slotB = "00000000-0000-4000-8000-0000000000b2";
  const renewalSummary = (renewal: CheckoutSummary["renewal"]): CheckoutSummary => ({
    planId: term.planId,
    name: term.label,
    areaLabel: "Market, Business or Tourism",
    priceCents: 6900,
    durationDays: 30,
    durationLabel: "30 days",
    slotCapacity: 1,
    monthlyActivationLimit: 4,
    slotTerms: [term],
    slotStatus: { verified: true, held: 4, pending: 0, limit: 4 },
    renewal,
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
  const payButton = () => screen.getByRole("button", { name: /Pay .* securely/ });
  const sent = (fetch: ReturnType<typeof vi.fn>) =>
    JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  it("renews one slot from its end date, with the renewal's own box naming the start date", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ checkoutUrl: "https://pay.ozow.com/x" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    render(
      <CheckoutConfirm
        summary={renewalSummary([
          { id: slotA, startsAt: "2026-11-20T10:00:00Z", postTitle: "Mountain bike" },
        ])}
      />
    );
    expect(screen.getByRole("heading", { name: "Renew your slot" })).toBeInTheDocument();
    // Every slot is held, but a renewal adds no slot: no limit notice.
    expect(screen.queryByTestId("slot-block-limit")).toBeNull();
    expect(screen.getByText("Mountain bike")).toBeInTheDocument();
    expect(screen.getByText("New days: 20 November 2026 – 20 December 2026")).toBeInTheDocument();
    expect(screen.getByText("20 November 2026 (when your current days end)")).toBeInTheDocument();
    const box = screen.getByRole("checkbox", { name: /My new days start on 20 November 2026/ });
    expect(
      screen.getByText(/If I cancel before they start, I get a full refund/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/My slot starts now/)).toBeNull();
    expect(payButton()).toBeDisabled();
    fireEvent.click(box);
    fireEvent.click(payButton());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(sent(fetch)).toEqual({
      planId: term.planId,
      slots: 1,
      expectedTotalCents: 6900,
      coolingOffConsent: true,
      renewSlotIds: [slotA],
    });
    expect(screen.getByRole("link", { name: "Back to My slots" })).toHaveAttribute(
      "href",
      "/dashboard/slots"
    );
  });

  it("renews every ticked slot in one payment (Renew all)", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ checkoutUrl: "https://pay.ozow.com/x" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetch);
    render(
      <CheckoutConfirm
        summary={renewalSummary([
          { id: slotA, startsAt: "2026-11-20T10:00:00Z", postTitle: "Mountain bike" },
          { id: slotB, startsAt: "2026-11-24T10:00:00Z", postTitle: null },
        ])}
      />
    );
    expect(screen.getByRole("heading", { name: "Renew your slots" })).toBeInTheDocument();
    expect(screen.getByTestId("checkout-total")).toHaveTextContent(formatPlanPrice(13800));
    expect(screen.getByText("When each slot's current days end")).toBeInTheDocument();
    expect(screen.getByText("Empty slot")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Mountain bike/ }));
    expect(screen.getByTestId("checkout-total")).toHaveTextContent(formatPlanPrice(6900));
    fireEvent.click(screen.getByRole("checkbox", { name: /My new days/ }));
    fireEvent.click(payButton());
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(sent(fetch).renewSlotIds).toEqual([slotB]);
    expect(sent(fetch).slots).toBe(1);
  });

  it("says when nothing can be renewed yet, or the slots cannot be read", () => {
    const { unmount } = render(<CheckoutConfirm summary={renewalSummary([])} />);
    expect(screen.getByTestId("renewal-none")).toHaveTextContent(
      "Nothing to renew right now. A slot can be renewed from 14 days before it ends."
    );
    expect(payButton()).toBeDisabled();
    unmount();
    render(<CheckoutConfirm summary={renewalSummary(null)} />);
    expect(screen.getByTestId("renewal-none")).toHaveTextContent(
      "Your slots cannot be shown right now."
    );
  });

  it("names an unpaid renewal still open for the same term", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "You already have a pending payment",
              code: "PENDING_PAYMENT_EXISTS",
              pendingPayment: {
                id: slotB,
                checkoutUrl: null,
                statusUrl: "/billing/success",
                canCancel: true,
                slots: 2,
                amountCents: 13800,
                renewal: true,
              },
            }),
            { status: 409 }
          )
      )
    );
    render(
      <CheckoutConfirm
        summary={renewalSummary([{ id: slotA, startsAt: "2026-11-20T10:00:00Z", postTitle: null }])}
      />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /My new days/ }));
    fireEvent.click(payButton());
    expect(await screen.findByTestId("unpaid-order")).toHaveTextContent(
      `Unpaid renewal: 2 slots, ${formatPlanPrice(13800)}`
    );
  });
});
