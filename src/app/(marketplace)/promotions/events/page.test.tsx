import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventsPage from "./page";

const { readCollection } = vi.hoisted(() => ({
  readCollection: vi.fn(),
}));
const { promotionCardSpy } = vi.hoisted(() => ({
  promotionCardSpy: vi.fn(),
}));

vi.mock("@/lib/foundation/marketplace-read", () => ({ readRestoredCollection: readCollection }));
vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => "api" }));

vi.mock("@/components/layout", () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  ),
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: (props: { title: string }) => {
    promotionCardSpy(props);
    return <div>{props.title}</div>;
  },
}));

vi.mock("./past-events-accordion", () => ({
  PastEventsAccordion: () => <div>Past Events</div>,
}));

/** Upcoming events for the first read, ended events for the second. */
function events(upcoming: unknown[], past: unknown[] = []) {
  readCollection.mockImplementation(async (_api: unknown, _collection: string, params) =>
    (params as URLSearchParams).get("event_state") === "ended"
      ? { rows: past, total: past.length }
      : { rows: upcoming, total: upcoming.length }
  );
}

describe("EventsPage", () => {
  it("shows upcoming events with their own logo and no host-business lookup", async () => {
    events([
      {
        id: "event-1",
        business_id: "biz-1",
        title: "Night Market",
        description: "Live music and food stalls.",
        photos: ["https://example.com/photo.jpg"],
        videos: [],
        logo_url: "https://example.com/event-logo.jpg",
        price_cents: null,
        price_negotiable: false,
        location_province: "Gauteng",
        location_city: "Johannesburg",
        start_date: "2099-01-10T00:00:00.000Z",
        end_date: "2099-01-11T00:00:00.000Z",
        boost_until: null,
        featured_until: null,
        view_count: null,
        created_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    render(await EventsPage());

    expect(screen.getByText("Night Market")).toBeInTheDocument();
    const card = promotionCardSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(card.logoUrl).toBe("https://example.com/event-logo.jpg");
    expect(card.businessName).toBeUndefined();
    expect(card.viewCount).toBeUndefined();
    expect(String(readCollection.mock.calls[0][2])).toBe("limit=48&event_order=start_asc");
    expect(String(readCollection.mock.calls[1][2])).toBe(
      "limit=24&event_state=ended&event_order=end_desc"
    );
  });

  it("sends users straight to event creation from the page header and empty state", async () => {
    events([]);

    render(await EventsPage());

    const links = screen.getAllByRole("link", { name: /List an event/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/post/create-tourism?type=event");
    }
    expect(screen.getByText("No upcoming events")).toBeInTheDocument();
  });
});
