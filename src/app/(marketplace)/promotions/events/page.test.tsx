import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventsPage from "./page";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));
const { promotionCardSpy } = vi.hoisted(() => ({
  promotionCardSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

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

vi.mock("@/lib/account/compat", () => ({
  ACCOUNT_PROFILE_TABLE: "account_profiles",
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
  normalizeOwnerRecords: (rows: unknown[]) => rows,
  readAccountVerificationStatus: () => "verified",
  readOwnerId: (row: { owner_id?: string | null; seller_id?: string | null }) =>
    row.owner_id ?? row.seller_id ?? null,
  withOwnerColumn: (fields: string) => fields,
}));

function createQueryResult<T>(data: T) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    or: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (value: { data: T }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

describe("EventsPage", () => {
  it("passes linked business logos into upcoming event cards", async () => {
    mockCreateClient.mockResolvedValue({
      from: (table: string) => {
        if (table === "promotions") {
          return createQueryResult([
            {
              id: "event-1",
              owner_id: "owner-1",
              business_id: "biz-1",
              title: "Night Market",
              description: "Live music and food stalls.",
              photos: ["https://example.com/photo.jpg"],
              videos: [],
              price_cents: null,
              price_negotiable: false,
              location_province: "Gauteng",
              location_city: "Johannesburg",
              start_date: "2099-01-10T00:00:00.000Z",
              end_date: "2099-01-11T00:00:00.000Z",
              boost_until: null,
              featured_until: null,
              view_count: 12,
              created_at: "2026-03-01T00:00:00.000Z",
            },
          ]);
        }

        if (table === "account_profiles") {
          return createQueryResult([]);
        }

        if (table === "businesses") {
          return createQueryResult([
            {
              id: "biz-1",
              business_name: "Nomsa Kitchen",
              logo_url: "https://example.com/logo.jpg",
            },
          ]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    } as never);

    render(await EventsPage());

    expect(screen.getByText("Night Market")).toBeInTheDocument();
    expect(promotionCardSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://example.com/logo.jpg",
      })
    );
  });

  it("sends users straight to event creation from the page header and empty state", async () => {
    mockCreateClient.mockResolvedValue({
      from: (table: string) => {
        if (table === "promotions") {
          return createQueryResult([]);
        }

        if (table === "account_profiles" || table === "businesses") {
          return createQueryResult([]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    } as never);

    render(await EventsPage());

    const links = screen.getAllByRole("link", { name: /Create Event/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/post/create-tourism?type=event");
    }
    expect(screen.getByText("No upcoming events")).toBeInTheDocument();
  });
});
