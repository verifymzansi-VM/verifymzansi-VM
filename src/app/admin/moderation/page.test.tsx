import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import AdminModerationPage from "./page";

const { mockCreateClient, mockCreateAdminClient, mockRedirect, mockLoggerError } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockRedirect: vi.fn(),
    mockLoggerError: vi.fn(),
  })
);

let listingQuery: ReturnType<typeof createQuery> | undefined;
let businessQuery: ReturnType<typeof createQuery> | undefined;
let promotionQuery: ReturnType<typeof createQuery> | undefined;
let editQuery: ReturnType<typeof createQuery> | undefined;

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/content/private-fields", () => ({
  withAllPrivateFields: async (_table: string, rows: unknown[]) => rows,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ error: mockLoggerError, info: vi.fn(), warn: vi.fn() }),
}));

vi.mock("@/components/admin/moderation/moderation-queue-client", () => ({
  ModerationQueueClient: ({
    items,
  }: {
    items: Array<{ title?: string; itemType: string; change_summary?: Array<{ label: string }> }>;
  }) => (
    <div>
      <p>queue-size:{items.length}</p>
      {items.map((item, index) => (
        <div key={`${item.itemType}-${index}`}>
          {`${item.itemType}:${item.title}`}
          {item.change_summary
            ? ` changes:${item.change_summary.map((c) => c.label).join(",")}`
            : ""}
        </div>
      ))}
    </div>
  ),
}));

function createQuery(data: unknown[], error: { message: string } | null = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error }),
    // The viewer's claimed items: none in these tests.
    in: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  return builder;
}

describe("AdminModerationPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    listingQuery = undefined;
    businessQuery = undefined;
    promotionQuery = undefined;
    editQuery = undefined;

    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "staff-1", app_metadata: { role: "admin" } } },
        }),
      },
    });

    mockCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "listings") {
          // The first listings query is the moderation queue; later ones load
          // duplicate-detection context and must not replace it.
          if (listingQuery) return createQuery([]);
          listingQuery = createQuery([
            {
              id: "listing-1",
              title: "Used iPhone 15",
              status: "pending_moderation",
              created_at: "2026-03-20T08:00:00.000Z",
              category: "electronics",
              owner_id: "user-1",
              video_thumbnail: "https://media.verifymzansi.com/listings/thumb.jpg",
            },
          ]);
          return listingQuery;
        }

        if (table === "businesses") {
          businessQuery = createQuery([
            {
              id: "business-1",
              business_name: "Nomsa Beauty Studio",
              business_type: "service",
              status: "pending_moderation",
              created_at: "2026-03-20T09:00:00.000Z",
              owner_id: "user-2",
            },
          ]);
          return businessQuery;
        }

        if (table === "promotions") {
          promotionQuery = createQuery([
            {
              id: "promotion-1",
              title: "Weekend Sale",
              status: "pending_moderation",
              created_at: "2026-03-20T10:00:00.000Z",
              category: "deal",
              owner_id: "user-3",
            },
          ]);
          return promotionQuery;
        }

        if (table === "content_edit_requests") {
          editQuery = createQuery([
            {
              id: "edit-1",
              target_type: "listing",
              target_id: "listing-live-1",
              owner_id: "user-1",
              area: "MZANSI_MARKET",
              status: "pending",
              created_at: "2026-03-20T11:00:00.000Z",
              proposed_data: {
                title: "Used iPhone 15 - updated",
                category: "electronics",
              },
              current_snapshot: {
                title: "Used iPhone 15",
              },
            },
          ]);
          return editQuery;
        }

        throw new Error(`Unexpected table ${table}`);
      },
    });
  });

  it("aggregates listings, businesses, and promotions into a single moderation queue", async () => {
    render(await AdminModerationPage());

    expect(screen.getByText("4 pending")).toBeInTheDocument();
    expect(screen.getByText("queue-size:4")).toBeInTheDocument();
    expect(screen.getByText("Listing:Used iPhone 15")).toBeInTheDocument();
    expect(screen.getByText("Business:Nomsa Beauty Studio")).toBeInTheDocument();
    expect(screen.getByText("Event:Weekend Sale")).toBeInTheDocument();
    expect(screen.getByText(/Listing edit:Used iPhone 15 - updated/)).toBeInTheDocument();
    expect(screen.getByText(/changes:Category,Title/i)).toBeInTheDocument();
    expect(listingQuery?.select).toHaveBeenCalledWith(expect.stringContaining("video_thumbnail"), {
      count: "exact",
    });
    const counted = { count: "exact" };
    for (const field of ["business_details", "cover_photo", "payment_methods_accepted"]) {
      expect(businessQuery?.select).toHaveBeenCalledWith(expect.stringContaining(field), counted);
    }
    expect(promotionQuery?.select).toHaveBeenCalledWith(
      expect.stringContaining("video_thumbnail"),
      counted
    );
    // Nothing held: no extra queries for claimed items.
    expect(listingQuery?.in).not.toHaveBeenCalled();
  });

  it("shows a warning when one moderation area fails to load instead of silently dropping it", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "listings") {
          return createQuery([
            {
              id: "listing-1",
              title: "Used iPhone 15",
              status: "pending_moderation",
              created_at: "2026-03-20T08:00:00.000Z",
              category: "electronics",
              owner_id: "user-1",
            },
          ]);
        }

        if (table === "businesses") {
          return createQuery([
            {
              id: "business-1",
              business_name: "Nomsa Beauty Studio",
              business_type: "service",
              status: "pending_moderation",
              created_at: "2026-03-20T09:00:00.000Z",
              owner_id: "user-2",
            },
          ]);
        }

        if (table === "promotions") {
          return createQuery([], { message: "column promotions.logo_url does not exist" });
        }

        if (table === "content_edit_requests") {
          return createQuery([]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    });

    render(await AdminModerationPage());

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some moderation items could not be loaded for: Tourism & Events."
    );
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText("queue-size:2")).toBeInTheDocument();
    expect(mockLoggerError).toHaveBeenCalledWith("Failed to load some moderation queues", {
      failedAreas: ["Tourism & Events"],
      listingsError: undefined,
      businessesError: undefined,
      promotionsError: "column promotions.logo_url does not exist",
      editRequestsError: undefined,
    });
  });

  it("always shows the items a moderator holds, and the true total", async () => {
    const { getMyClaimedItems } = await import("@/lib/services/queue-claims");
    vi.mocked(getMyClaimedItems).mockResolvedValue([{ type: "listing", id: "listing-held" }]);
    const row = (id: string, title: string) => ({
      id,
      title,
      status: "pending_moderation",
      created_at: "2026-03-20T08:00:00.000Z",
      category: "electronics",
      owner_id: "user-1",
    });
    let listingCalls = 0;
    mockCreateAdminClient.mockReturnValue({
      from: (table: string) => {
        if (table === "listings") {
          listingCalls += 1;
          const q = createQuery([row("listing-old", "Oldest listing")]);
          q.limit = vi.fn().mockResolvedValue({
            data: listingCalls === 1 ? [row("listing-old", "Oldest listing")] : [],
            error: null,
            count: 60,
          });
          q.in = vi
            .fn()
            .mockResolvedValue({ data: [row("listing-held", "Held listing")], error: null });
          return q;
        }
        return createQuery([]);
      },
    });

    render(await AdminModerationPage());

    expect(screen.getByText("Listing:Held listing")).toBeInTheDocument();
    expect(screen.getByText("60 pending")).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 60 waiting items/)).toBeInTheDocument();
  });
});
