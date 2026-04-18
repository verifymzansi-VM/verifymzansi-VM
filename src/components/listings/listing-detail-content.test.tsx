/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const { listingDetailClientState } = vi.hoisted(() => ({
  listingDetailClientState: {
    shouldThrow: true,
    lastProps: null as null | Record<string, unknown>,
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("lucide-react", () => ({
  Calendar: () => <span data-testid="icon-calendar" />,
  Eye: () => <span data-testid="icon-eye" />,
  MapPin: () => <span data-testid="icon-map-pin" />,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/trust/trust-badge", () => ({
  TrustBadge: () => <span data-testid="trust-badge" />,
}));

vi.mock("@/components/listings/listing-card", () => ({
  ListingCard: () => <div data-testid="listing-card" />,
}));

vi.mock("@/app/listing/[id]/client", () => ({
  ListingDetailClient: (props: Record<string, unknown>) => {
    listingDetailClientState.lastProps = props;
    if (listingDetailClientState.shouldThrow) {
      throw new Error("Media render crash");
    }
    return <div data-testid="listing-detail-client" />;
  },
}));

vi.mock("@/app/listing/[id]/listing-contact-actions", () => ({
  ListingContactActions: () => <div data-testid="contact-actions" />,
}));

vi.mock("@/lib/constants/trust-scale", () => ({
  computeTrustLevel: () => null,
}));

vi.mock("@/lib/account/compat", () => ({
  readOwnerId: () => null,
}));

vi.mock("@/lib/utils/format", () => ({
  formatZAR: (value: number) => `R ${value}`,
}));

vi.mock("@/lib/constants/categories", () => ({
  CATEGORIES: [],
}));

vi.mock("@/lib/constants/listing-condition", () => ({
  getListingConditionLabel: (value: string) => value,
}));

const { ListingDetailContent } = await import("@/components/listings/listing-detail-content");

describe("ListingDetailContent", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listingDetailClientState.shouldThrow = true;
    listingDetailClientState.lastProps = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders media fallback when ListingDetailClient throws", () => {
    render(
      <ListingDetailContent
        listing={{
          id: "listing-1",
          owner_id: "owner-1",
          title: "Test listing",
          description: "Test description",
          price_cents: 12300000,
          price_negotiable: false,
          category: "jobs_services",
          condition: "like_new",
          attributes: null,
          photos: [],
          videos: [],
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          location_suburb: null,
          location_address: null,
          contact_methods: ["call"],
          created_at: new Date().toISOString(),
        }}
        seller={{
          display_name: "You",
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          account_verification_status: null,
        }}
        showContactActions={false}
        showSimilarListings={false}
      />
    );

    expect(screen.getByText("Image failed to load")).toBeTruthy();
  });

  it("updates the visible view count after a recorded detail-page view", async () => {
    listingDetailClientState.shouldThrow = false;

    render(
      <ListingDetailContent
        listing={{
          id: "listing-2",
          owner_id: "owner-1",
          title: "Viewed listing",
          description: "Test description",
          price_cents: 12300000,
          price_negotiable: false,
          category: "jobs_services",
          condition: "like_new",
          attributes: null,
          photos: [],
          videos: [],
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          location_suburb: null,
          location_address: null,
          contact_methods: ["call"],
          created_at: new Date().toISOString(),
          view_count: 7,
        }}
        seller={null}
        showContactActions={false}
        showSimilarListings={false}
      />
    );

    expect(screen.getByText("7 views")).toBeTruthy();
    expect(listingDetailClientState.lastProps?.onViewRecorded).toBeTypeOf("function");

    await act(async () => {
      (listingDetailClientState.lastProps?.onViewRecorded as (() => void) | undefined)?.();
    });

    expect(screen.getByText("8 views")).toBeTruthy();
  });

  it("renders review mode without public contact actions", () => {
    listingDetailClientState.shouldThrow = false;

    const { container } = render(
      <ListingDetailContent
        listing={{
          id: "listing-3",
          owner_id: "owner-1",
          title: "Preview listing",
          description: "Review mode preview",
          price_cents: 456000,
          price_negotiable: false,
          category: "jobs_services",
          condition: "like_new",
          attributes: { brand: "Apple" },
          photos: [],
          videos: [],
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          location_suburb: null,
          location_address: null,
          contact_methods: ["call"],
          created_at: new Date().toISOString(),
        }}
        seller={{
          display_name: "You",
          location_province: "KwaZulu-Natal",
          location_city: "Richards Bay",
          account_verification_status: null,
        }}
        showContactActions={false}
        showSimilarListings={false}
        layoutMode="review"
      />
    );

    expect(container.querySelector('article[data-layout-mode="review"]')).toBeTruthy();
    expect(screen.queryByTestId("contact-actions")).toBeNull();
    expect(screen.getByText("Preview mode")).toBeTruthy();
  });
});
