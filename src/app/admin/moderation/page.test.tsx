import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminModerationPage from "./page";

const { mockCreateClient, mockCreateAdminClient, mockRedirect } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("@/lib/auth/roles", () => ({
  isStaff: vi.fn(() => true),
  isModeratorOrAdmin: vi.fn(() => true),
}));

vi.mock("./moderation-queue-client", () => ({
  ModerationQueueClient: ({ items }: { items: Array<{ title?: string; itemType: string }> }) => (
    <div>
      <p>queue-size:{items.length}</p>
      {items.map((item, index) => (
        <div key={`${item.itemType}-${index}`}>{`${item.itemType}:${item.title}`}</div>
      ))}
    </div>
  ),
}));

function createQuery(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data }),
  };

  return builder;
}

describe("AdminModerationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
          return createQuery([
            {
              id: "promotion-1",
              title: "Weekend Sale",
              status: "pending_moderation",
              created_at: "2026-03-20T10:00:00.000Z",
              category: "deal",
              owner_id: "user-3",
            },
          ]);
        }

        throw new Error(`Unexpected table ${table}`);
      },
    });
  });

  it("aggregates listings, businesses, and promotions into a single moderation queue", async () => {
    render(await AdminModerationPage());

    expect(screen.getByText("3 Pending")).toBeInTheDocument();
    expect(screen.getByText("queue-size:3")).toBeInTheDocument();
    expect(screen.getByText("Listing:Used iPhone 15")).toBeInTheDocument();
    expect(screen.getByText("Business:Nomsa Beauty Studio")).toBeInTheDocument();
    expect(screen.getByText("Promotion:Weekend Sale")).toBeInTheDocument();
  });
});
