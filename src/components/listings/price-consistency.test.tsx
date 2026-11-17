/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// One price, written once: the grid card, the list card, the showroom card,
// the home rail card, the post page and the immersive viewer all show the same
// words for the same post.

const { cardEyebrows } = vi.hoisted(() => ({ cardEyebrows: [] as Array<string | null> }));

vi.mock("@/components/listings/poster-card-shell", () => ({
  PosterCardShell: ({ eyebrow }: { eyebrow?: string | null }) => {
    cardEyebrows.push(eyebrow ?? null);
    return <span data-testid="card-price">{eyebrow ?? ""}</span>;
  },
}));

vi.mock("@/components/home/auto-scroll-rail", () => ({
  useAutoScrollRailItemState: () => ({ isActive: false, isRailDragging: false }),
}));

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

vi.mock("@/components/listings/content-like-button", () => ({
  ContentLikeButton: () => null,
}));

vi.mock("@/components/ui/video-view-tracker", () => ({
  VideoViewTracker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { ListingCard } = await import("@/components/listings/listing-card");
const { ListingCardList } = await import("@/components/listings/listing-card-list");
const { MarketPreviewCard } = await import("@/components/home/market-preview-card");
const { ListingDetailContent } = await import("@/components/listings/listing-detail-content");
const { listingToCarouselItem } = await import("@/components/showrooms/carousel-item-transforms");
const { presentListingSlide } = await import("@/lib/feed/presenters");

type Terms = {
  category: string;
  price_cents: number | null;
  price_mode: "amount" | "free" | "on_request";
  price_negotiable: boolean;
};

function record(terms: Terms) {
  return {
    id: "listing-1",
    owner_id: "owner-1",
    title: "Samsung Galaxy phone",
    description: "Synthetic listing.",
    condition: null,
    attributes: null,
    photos: ["/images/promo/promo-1.png"],
    videos: [],
    video_thumbnail: null,
    logo_url: null,
    location_province: "Gauteng",
    location_city: "Johannesburg",
    location_suburb: null,
    location_address: null,
    contact_methods: ["form"],
    created_at: "2026-11-12T08:00:00.000Z",
    ...terms,
  };
}

/** The price text each surface shows for one post. */
function surfaces(terms: Terms) {
  cardEyebrows.length = 0;
  const listing = record(terms);
  render(
    <ListingCard
      id={listing.id}
      title={listing.title}
      price={listing.price_cents ?? 0}
      priceMode={listing.price_mode}
      negotiable={listing.price_negotiable}
      province={listing.location_province}
      city={listing.location_city}
      category={listing.category}
      createdAt={listing.created_at}
    />
  );
  render(
    <MarketPreviewCard
      href={`/listing/${listing.id}`}
      title={listing.title}
      price={listing.price_cents ? listing.price_cents / 100 : null}
      priceMode={listing.price_mode}
      city={listing.location_city}
      provinceCode="GP"
    />
  );
  const [gridCard, homeRailCard] = cardEyebrows;
  cleanup();

  render(
    <ListingCardList
      id={listing.id}
      title={listing.title}
      price={listing.price_cents ?? 0}
      priceMode={listing.price_mode}
      province={listing.location_province}
      city={listing.location_city}
      category={listing.category}
      createdAt={listing.created_at}
    />
  );
  const listCardText = document.body.textContent ?? "";
  cleanup();

  render(
    <ListingDetailContent
      listing={listing}
      seller={{
        display_name: "Lerato F.",
        location_province: "Gauteng",
        location_city: "Johannesburg",
        account_verification_status: "verified",
      }}
      showContactActions={false}
      showSimilarListings={false}
    />
  );
  const postPagePrice = screen.getByText(/^(R\d|Free$|Price on request$|Salary)/).textContent;
  const postPageNegotiable = screen.queryByText("Negotiable") !== null;
  cleanup();

  const figure = presentListingSlide(listing, null, {
    views: 0,
    likes: 0,
    viewerHasLiked: false,
  }).headline.figure;

  return {
    gridCard,
    homeRailCard,
    listCardText,
    showroomCard: listingToCarouselItem(listing).eyebrow,
    postPagePrice,
    postPageNegotiable,
    viewerPrice: figure?.value,
    viewerNegotiable: figure?.note === "Negotiable",
  };
}

describe("one price format on cards and the post page", () => {
  afterEach(() => cleanup());

  it("writes an amount the same way everywhere", () => {
    const shown = surfaces({
      category: "electronics",
      price_cents: 145_000,
      price_mode: "amount",
      price_negotiable: false,
    });
    const price = "R1 450";
    expect(shown.gridCard).toBe(price);
    expect(shown.homeRailCard).toBe(price);
    expect(shown.showroomCard).toBe(price);
    expect(shown.listCardText).toContain(price);
    expect(shown.postPagePrice).toBe(price);
    expect(shown.viewerPrice).toBe(price);
    expect(shown.postPageNegotiable).toBe(false);
  });

  it("keeps cents and marks a negotiable amount on every surface", () => {
    const shown = surfaces({
      category: "electronics",
      price_cents: 1_249_950,
      price_mode: "amount",
      price_negotiable: true,
    });
    const price = "R12 499.50";
    expect(shown.gridCard).toBe(`${price} · Neg`);
    expect(shown.showroomCard).toBe(price);
    expect(shown.homeRailCard).toBe(price);
    expect(shown.postPagePrice).toBe(price);
    expect(shown.postPageNegotiable).toBe(true);
    expect(shown.viewerPrice).toBe(price);
    expect(shown.viewerNegotiable).toBe(true);
  });

  it("says Free, never Price on request, for a free item, and never Negotiable", () => {
    const shown = surfaces({
      category: "home_lifestyle",
      price_cents: 0,
      price_mode: "free",
      price_negotiable: true,
    });
    expect(shown.gridCard).toBe("Free");
    expect(shown.homeRailCard).toBe("Free");
    expect(shown.showroomCard).toBe("Free");
    expect(shown.listCardText).toContain("Free");
    expect(shown.postPagePrice).toBe("Free");
    expect(shown.viewerPrice).toBe("Free");
    expect(shown.postPageNegotiable).toBe(false);
    expect(shown.viewerNegotiable).toBe(false);
  });

  it("says Price on request on the post page and keeps cards quiet", () => {
    const shown = surfaces({
      category: "electronics",
      price_cents: null,
      price_mode: "on_request",
      price_negotiable: true,
    });
    expect(shown.gridCard).toBeNull();
    expect(shown.homeRailCard).toBeNull();
    expect(shown.showroomCard).toBeNull();
    expect(shown.postPagePrice).toBe("Price on request");
    expect(shown.postPageNegotiable).toBe(true);
    expect(shown.viewerPrice).toBe("Price on request");
  });

  it("never marks a job's salary as negotiable", () => {
    const shown = surfaces({
      category: "jobs_services",
      price_cents: 1_500_000,
      price_mode: "amount",
      price_negotiable: true,
    });
    expect(shown.gridCard).toBe("R15 000");
    expect(shown.postPagePrice).toBe("R15 000");
    expect(shown.postPageNegotiable).toBe(false);
    expect(shown.viewerNegotiable).toBe(false);
  });
});
