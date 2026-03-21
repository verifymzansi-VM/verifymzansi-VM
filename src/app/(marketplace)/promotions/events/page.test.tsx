import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventsPage from "./page";

const { mockCreateAdminClient } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
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
  PromotionCard: ({ title }: { title: string }) => <div>{title}</div>,
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
  it("sends users straight to event creation from the page header and empty state", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "promotions") {
          return createQueryResult([]);
        }

        if (table === "account_profiles" || table === "businesses") {
          return createQueryResult([]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    });

    render(await EventsPage());

    const links = screen.getAllByRole("link", { name: /Create Event/i });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/post/create-promotion?type=event");
    }
    expect(screen.getByText("No upcoming events")).toBeInTheDocument();
  });
});
