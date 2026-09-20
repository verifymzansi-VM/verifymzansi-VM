import { expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/account/ensure-profile", () => ({ ensureAccountProfile: vi.fn() }));
import { getSiteVisitStats, EMPTY_SITE_VISIT_STATS } from "./admin-queries";
it("loads database aggregates without fetching individual visits", async () => {
  rpc.mockResolvedValue({
    data: { ...EMPTY_SITE_VISIT_STATS, visits30d: 12400, uniqueVisitors30d: 12400 },
    error: null,
  });
  expect(await getSiteVisitStats()).toMatchObject({
    available: true,
    visits30d: 12400,
    uniqueVisitors30d: 12400,
  });
  expect(rpc).toHaveBeenCalledWith("get_site_visit_stats");
});
it("marks a missing migration as unavailable", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "function missing" } });
  expect(await getSiteVisitStats()).toEqual(EMPTY_SITE_VISIT_STATS);
});
it("fails soft for transport errors", async () => {
  rpc.mockRejectedValue(new Error("network"));
  expect(await getSiteVisitStats()).toEqual(EMPTY_SITE_VISIT_STATS);
});
