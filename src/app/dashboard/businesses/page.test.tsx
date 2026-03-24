import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BusinessesPage from "./page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/account/compat", () => ({
  applyOwnerFilter: vi.fn((query) => query),
  getOwnerColumn: vi.fn().mockResolvedValue("owner_id"),
}));

vi.mock("@/lib/services/plan-tier", () => ({
  getActivePlanTierForArea: vi.fn().mockResolvedValue("starter"),
}));

vi.mock("@/lib/services/entitlements", () => ({
  canBoost: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock("@/components/listings/boost-button", () => ({
  BoostButton: () => <button type="button">Boost</button>,
}));

function createThenableQuery(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (value: { data: unknown[] }) => unknown) => resolve({ data }),
  };

  return builder;
}

describe("Dashboard businesses page", () => {
  const mockSupabase = {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockResolvedValue(
      mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>
    );
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "businesses") {
        return createThenableQuery([]);
      }

      return createThenableQuery([]);
    });
  });

  it("shows a created banner after submitting a business", async () => {
    render(await BusinessesPage({ searchParams: Promise.resolve({ created: "true" }) }));

    expect(screen.getByText("Business submitted")).toBeInTheDocument();
    expect(screen.getByText(/waiting for moderation/i)).toBeInTheDocument();
  });

  it("shows an updated banner after editing a live business", async () => {
    render(await BusinessesPage({ searchParams: Promise.resolve({ updated: "true" }) }));

    expect(screen.getByText("Business updated")).toBeInTheDocument();
    expect(screen.getByText(/resubmitted for review/i)).toBeInTheDocument();
  });
});
