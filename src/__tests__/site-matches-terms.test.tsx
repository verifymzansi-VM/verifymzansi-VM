// The public site must not promise what the Terms (posting-v5) or the live
// product do not: paid add-ons and the sponsor offer are hidden until they
// work (src/lib/hidden-features.ts), and the free first post is described as
// the Terms' "Free first post & visibility" section describes it.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BillingFaq } from "@/components/billing/billing-faq";
import { PricingOffers } from "@/components/billing/pricing-offers";
import { RetailPricing } from "@/components/billing/retail-pricing";
import { INDIVIDUAL_SLOT_LIMIT, POSTS_PER_SLOT_PER_30_DAYS } from "@/lib/billing/slot-checkout";
import postingTermsV5 from "@/lib/legal/terms-documents/posting-v5.json";
import { TrialPolicy } from "@/components/billing/trial-policy";
import { getPlanFeatureItems, PLANS, RETAIL_OFFERS } from "@/lib/constants/pricing";
import type { PublicSponsor } from "@/lib/organisations/sponsors";
import type * as HiddenFeatures from "@/lib/hidden-features";

// These guards check the wording with paid add-ons and the sponsor offer
// switched off, the branch kept for turning them off again. Both are on in
// production (owner's decision of 22 November 2026); the wording they show is
// listed for review in the launch checklist item 71 pull request.
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  SHOW_PAID_ADDONS: false,
  SHOW_SPONSOR_OFFER: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));
vi.mock("@/components/analytics/analytics-impressions", () => ({
  AnalyticsImpressions: () => null,
}));

const sponsors = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@/lib/organisations/sponsors", () => ({
  getPublicSponsors: async () => sponsors.list,
  organisationTypeLabel: () => "Chamber",
  sponsorArea: () => "Example District",
}));

const SPONSOR: PublicSponsor = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "example-chamber",
  name: "Example Chamber",
  organisation_type: "chamber",
  service_area: null,
  province: null,
  logo_url: null,
  programme_status: "founding_trial",
  live_businesses: 3,
  accepting_applications: false,
  places_available: null,
  on_strip: true,
  on_home: true,
};

describe("the free first post (Terms: Free first post & visibility)", () => {
  it("states the Terms' rules and no campaign or limited-places wording", () => {
    const { container } = render(<BillingFaq />);
    const text = container.textContent ?? "";

    expect(text).toContain("Once your ID has been reviewed, your first post is free for 7 days");
    expect(text).toContain("The 7 days start when we approve the post, not when you submit it.");
    expect(text).toContain("The free post is available once per ID-reviewed person.");
    expect(text).toContain("deleting the post or your account does not reset it");
    expect(text).toContain("A rejected post does not use the free post");
    expect(text).toContain("Only one post at a time can wait for the free post.");
    expect(text).toContain("the post uses that slot instead and your free post stays unused");
    expect(text).toContain("A sponsored place, or a free post we grant you, counts as your");
    expect(text).not.toMatch(
      /Campaign availability|frees the space for another member|location verification|one free programme/
    );
  });

  it("says one free post per ID-reviewed person on the plan cards and the free post card", () => {
    render(
      <RetailPricing
        offers={RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} as never }))}
        onSale
        defaultArea="PROMOTIONS_EVENTS"
      />
    );
    expect(
      screen.getByText("One free post per ID-reviewed person. No payment, nothing renews.")
    ).toBeInTheDocument();

    render(<TrialPolicy />);
    expect(screen.getByText("One per ID-reviewed person.")).toBeInTheDocument();
  });
});

describe("paid add-ons, hidden until they deliver", () => {
  it("are not listed on the plan cards or in the plan features", () => {
    const { container } = render(
      <RetailPricing
        offers={RETAIL_OFFERS.map((offer) => ({ ...offer, planIds: {} as never }))}
        onSale
      />
    );
    expect(container.textContent).not.toMatch(/Urgent/);
    for (const plan of PLANS) {
      expect(getPlanFeatureItems(plan, { includeDisabled: true }).map((i) => i.text)).not.toContain(
        "Optional Urgent label add-on"
      );
    }
  });
});

describe("the pricing page's offers (Terms: Pricing)", () => {
  const terms = JSON.stringify(postingTermsV5);
  const offers = RETAIL_OFFERS.map((offer) => ({
    ...offer,
    planIds: { MZANSI_MARKET: "p", MZANSI_BUSINESS: "p", PROMOTIONS_EVENTS: "p" },
  }));

  it("states only what the Terms say about Individual slots and free events", () => {
    const { container } = render(<PricingOffers offers={offers} onSale showMultiListing={false} />);
    const text = container.textContent ?? "";

    // Prices and terms.
    expect(terms).toContain(
      "Individual slots cost R69 per slot for each 30 days: R69 for 30 days, R207 for 90 days or R414 for 180 days."
    );
    for (const price of ["R69", "R207", "R414"]) expect(text).toContain(price);
    // How many slots at a time.
    expect(terms).toContain(
      `You may hold 1 to ${INDIVIDUAL_SLOT_LIMIT} Individual slots at a time.`
    );
    expect(text).toContain(`Hold up to ${INDIVIDUAL_SLOT_LIMIT} slots at a time.`);
    // Fair use: posts going live per slot per 30 days.
    expect(terms).toContain(
      `each paid slot can take at most ${POSTS_PER_SLOT_PER_30_DAYS} posts going live in each 30-day period`
    );
    expect(text).toContain(`Up to ${POSTS_PER_SLOT_PER_30_DAYS} posts per 30 days`);
    // Any section.
    expect(terms).toContain(
      "An Individual slot can hold a post in any of the three posting areas."
    );
    expect(text).toContain("Market, Business or Tourism");
    // Free events.
    expect(terms).toContain("Events are free until the event ends");
    expect(text).toContain("live until the event ends");
    // Nothing on hold or not built.
    expect(text).not.toMatch(/sponsor|Urgent|Boost|Featured|renews automatically|team/i);
  });
});

describe("the sponsor offer, on hold", () => {
  it("is not offered on the home page's sponsor section", async () => {
    sponsors.list = [SPONSOR];
    const { HomeSponsorsSection } = await import("@/components/home/home-sponsors-section");
    render(await HomeSponsorsSection());
    expect(screen.getByRole("link", { name: "See supported businesses" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a Business Sponsor" })).toBeNull();
  });

  it("is not offered on the Business Sponsors page, which still lists current sponsors", async () => {
    sponsors.list = [SPONSOR];
    const { default: SponsorsPage } = await import("@/app/sponsors/page");
    const { container } = render(await SponsorsPage());
    expect(screen.getByText("Example Chamber")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Become a Business Sponsor" })).toBeNull();
    expect(screen.queryByText("Want to support local businesses?")).toBeNull();
    expect(container.textContent).not.toMatch(/Give 25 to 250 businesses/);
  });

  it("makes no 'first sponsors are joining' promise when none is listed", async () => {
    sponsors.list = [];
    const { default: SponsorsPage } = await import("@/app/sponsors/page");
    const { container } = render(await SponsorsPage());
    expect(container.textContent).not.toMatch(/are joining|Founding programmes open/);
    expect(screen.getByText("No sponsors yet")).toBeInTheDocument();
  });
});

describe("links to hidden sections and the hidden pricing package block", () => {
  it("drops the sponsor card and fees, and states the package rules on the multi-listing card", async () => {
    const { EnterprisePricing } = await import("@/components/billing/enterprise-pricing");
    const { container } = render(<EnterprisePricing checkoutEnabled retailFromCents={6900} />);
    const text = container.textContent ?? "";
    expect(screen.queryByRole("link", { name: /Full details of Business Sponsor/ })).toBeNull();
    expect(container.querySelector("#programme-prices")).toBeNull();
    expect(text).toMatch(/Two ways to advertise/);
    expect(text).toMatch(/From R500\s*for 30 days/);
    expect(text).toMatch(/From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days\./);
    expect(text).not.toMatch(/administrators|10 to 100|sponsor/i);
  });

  it("says nothing about Boost or Featured on the showroom help page", async () => {
    const { default: ShowroomHelpPage } = await import("@/app/help/showroom/page");
    const { container } = render(<ShowroomHelpPage />);
    expect(container.textContent).toMatch(
      /every live post gets an equal turn at the front of the showroom\./
    );
    expect(container.textContent).not.toMatch(/Boost and Featured/);
  });
});

describe("the hidden Multi-listing package on Advertise", () => {
  it("uses the package rules (from 5 slots, R100 per slot per 30 days), not the old ones", async () => {
    vi.resetModules();
    vi.doMock("@/lib/constants/pricing", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      PACKAGES_ON_SALE: true,
    }));
    vi.doMock("@/lib/commercial/plans", () => ({
      getCommercialCatalog: async () => ({
        retail: [],
        source: "database",
        onSale: false,
      }),
    }));
    vi.doMock("@/components/brand", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      VerificationEmblem: () => null,
    }));
    const { default: AdvertisePage } = await import("@/app/advertise/page");
    const { container } = render(await AdvertisePage());
    const section = container.querySelector("#multi-listing");
    const text = section?.textContent ?? "";

    expect(text).toMatch(/From 5 slots at R100 per slot per 30 days, for 30, 90 or 180 days/);
    expect(text).toMatch(/Up to 4 posts going live per slot per 30 days/);
    expect(text).toMatch(/by invoice at the same price/);
    expect(text).not.toMatch(/administrators|written quote|10 to 100|From 10/);
    vi.doUnmock("@/lib/constants/pricing");
    vi.doUnmock("@/lib/commercial/plans");
    vi.doUnmock("@/components/brand");
  });
});

describe("the hidden multi-listing nudge", () => {
  it("states only the package rules on sale today (P4a): no team, adding later, renewal or invoice", async () => {
    vi.resetModules();
    vi.doMock("@/lib/constants/pricing", async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      PACKAGES_ON_SALE: true,
    }));
    const { MultiListingNudge } = await import("@/components/billing/multi-listing-nudge");
    const { container } = render(<MultiListingNudge emphasis="strong" />);
    const text = container.textContent ?? "";

    expect(text).toMatch(
      /A Multi-listing package keeps 5 to 250 posts live at the same time for 30, 90 or 180 days, at R100 per slot per 30 days\./
    );
    expect(text).not.toMatch(
      /10 to 100|lower price|administrators|team|later|renew|invoice|quote/i
    );
    vi.doUnmock("@/lib/constants/pricing");
  });
});
