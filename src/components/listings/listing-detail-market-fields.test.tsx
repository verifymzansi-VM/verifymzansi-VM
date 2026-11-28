/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ListingDetailRecord } from "@/components/listings/listing-detail-content";

// The public listing page shows the Market answers with the real category
// config (listing-detail-content.test.tsx covers the page with an empty one).
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/app/listing/[id]/client", () => ({
  ListingDetailClient: () => <div data-testid="listing-detail-client" />,
}));
vi.mock("@/app/listing/[id]/listing-contact-actions", () => ({
  ListingContactActions: () => <div data-testid="contact-actions" />,
}));

const { ListingDetailContent } = await import("@/components/listings/listing-detail-content");

function listing(overrides: Partial<ListingDetailRecord>): ListingDetailRecord {
  return {
    id: "listing-1",
    owner_id: "owner-1",
    title: "Example post",
    description: "A description of the example post.",
    price_cents: 150000,
    price_negotiable: false,
    category: "clothing_accessories",
    condition: null,
    attributes: {},
    photos: [],
    videos: [],
    video_thumbnail: null,
    location_province: "Gauteng",
    location_city: "Johannesburg",
    location_suburb: null,
    contact_methods: ["in_app"],
    created_at: "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

function show(record: ListingDetailRecord) {
  return render(
    <ListingDetailContent
      listing={record}
      seller={null}
      showContactActions={false}
      showSimilarListings={false}
    />
  );
}

function fact(label: string) {
  return screen.getByText(label, { selector: "p" }).parentElement!;
}

describe("ListingDetailContent: Market answers on the public page", () => {
  it("shows size, who it is for and how the buyer gets it, with the meet-safely line", () => {
    show(
      listing({
        attributes: {
          size: "M",
          gender: "women",
          delivery_methods: ["collect", "meet_public", "seller_delivers"],
        },
      })
    );
    expect(within(fact("Size")).getByText("M")).toBeInTheDocument();
    expect(within(fact("For")).getByText("Women")).toBeInTheDocument();
    expect(
      within(fact("How the buyer gets it")).getByText(
        "Collect, Meet in a public place, Seller delivers"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Meet in a busy public place in daylight. Some police stations allow meet-ups; check with yours first."
      )
    ).toBeInTheDocument();
  });

  it("shows no meet-safely line without delivery methods", () => {
    show(listing({ attributes: { size: "M" } }));
    expect(document.querySelector("[data-meet-safely]")).toBeNull();
  });

  it("shows the property dates, rental terms and pets choice in plain words", () => {
    show(
      listing({
        category: "property",
        attributes: {
          property_type: "house",
          listing_intent: "rent",
          available_from: "2026-12-01",
          deposit_zar: 9000,
          lease_term: "12_months",
          utilities_included: ["prepaid_electricity", "water"],
          pets_policy: "ask",
          pets_allowed: true,
        },
      })
    );
    expect(within(fact("Available from")).getByText("1 December 2026")).toBeInTheDocument();
    expect(within(fact("Deposit")).getByText("R9 000")).toBeInTheDocument();
    expect(within(fact("Lease term")).getByText("12 months")).toBeInTheDocument();
    expect(
      within(fact("Included in the rent")).getByText("Prepaid electricity, Water")
    ).toBeInTheDocument();
    expect(within(fact("Pets")).getByText("Ask")).toBeInTheDocument();
    // Pets are shown once, from the choice.
    expect(screen.queryByText("Pets Allowed")).toBeNull();
  });

  it("shows an older post's pets yes/no as the pets choice", () => {
    show(
      listing({
        category: "property",
        attributes: { property_type: "house", listing_intent: "sale", pets_allowed: true },
      })
    );
    expect(within(fact("Pets")).getByText("Allowed")).toBeInTheDocument();
  });

  it("tells job seekers never to pay to apply on every job post", () => {
    show(listing({ category: "jobs_services", attributes: { job_type: "full_time" } }));
    expect(screen.getByRole("note")).toHaveTextContent("Never pay to apply for a job.");
  });

  it("shows the seller's website and social links as tappable links", () => {
    show(
      listing({
        website: "https://shop.example.co.za",
        social_links: { facebook: "https://facebook.com/shop", youtube: "https://youtube.com/@s" },
      })
    );
    const links = screen.getByRole("region", { name: "Links" });
    expect(within(links).getByRole("link", { name: "Website" })).toHaveAttribute(
      "href",
      "https://shop.example.co.za"
    );
    expect(within(links).getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://facebook.com/shop"
    );
    expect(within(links).getByRole("link", { name: "YouTube" })).toHaveAttribute(
      "href",
      "https://youtube.com/@s"
    );
  });
});
