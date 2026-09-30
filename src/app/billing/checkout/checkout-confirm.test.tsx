import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutConfirm, type CheckoutSummary } from "./checkout-confirm";

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
