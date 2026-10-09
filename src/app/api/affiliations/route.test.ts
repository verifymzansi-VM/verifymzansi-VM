import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { GET } from "./route";

function setup(failedTable?: string, noBusinesses = false) {
  const tables = ["businesses", "organisation_applications", "organisation_affiliations"];
  const queries = Object.fromEntries(
    tables.map((table) => {
      const result =
        table === failedTable
          ? { data: null, error: { message: "internal database detail", code: "XX000" } }
          : {
              data:
                table === "businesses"
                  ? noBusinesses
                    ? []
                    : [{ id: "business-1" }]
                  : [{ id: table }],
              error: null,
            };
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return [table, query];
    })
  );
  const from = vi.fn((table: string) => queries[table]);
  mocks.createAdminClient.mockReturnValue({ from });
  return { queries, from };
}

describe("GET /api/affiliations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "member-1" } } }) },
    });
  });

  it("scopes both application and business ownership reads and prevents caching", async () => {
    const { queries } = setup();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      applications: [{ id: "organisation_applications" }],
      affiliations: [{ id: "organisation_affiliations" }],
    });
    expect(queries.businesses.eq).toHaveBeenCalledWith("owner_id", "member-1");
    expect(queries.organisation_applications.eq).toHaveBeenCalledWith("applicant_id", "member-1");
    expect(queries.organisation_affiliations.in).toHaveBeenCalledWith("business_id", [
      "business-1",
    ]);
  });

  it.each(["businesses", "organisation_applications", "organisation_affiliations"])(
    "reports %s query failures without pretending the inbox is empty",
    async (table) => {
      setup(table);
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("internal database detail");
    }
  );

  it("skips affiliations lookup when the member has no businesses", async () => {
    const { from } = setup(undefined, true);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ affiliations: [] });
    expect(from).not.toHaveBeenCalledWith("organisation_affiliations");
  });

  it("rejects unauthenticated access before privileged queries", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });
    expect((await GET()).status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a safe retryable error when the client throws", async () => {
    mocks.createClient.mockRejectedValue(new Error("internal service detail"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal service detail");
  });
});
