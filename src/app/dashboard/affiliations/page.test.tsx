import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/components/organisations/affiliation-request-panel", () => ({
  AffiliationRequestPanel: () => null,
}));

import AffiliationsPage from "./page";

describe("affiliation dashboard availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    });
  });

  it.each([
    "businesses",
    "organisation_applications",
    "organisation_admins",
    "organisation_affiliations",
  ])("uses the dashboard error boundary when %s is unavailable", async (failedTable) => {
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => {
        const result = {
          data: table === "businesses" ? [{ id: "business-1" }] : [],
          error: table === failedTable ? { message: "internal database detail" } : null,
        };
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          then: (resolve: (value: typeof result) => unknown) =>
            Promise.resolve(result).then(resolve),
        };
      },
    });
    await expect(AffiliationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "Affiliations are temporarily unavailable"
    );
  });
});
