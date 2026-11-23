import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Roadmap M2.8: the engagement and analytics beacons called database commands
// that the live backend does not have. They now answer 204 and touch nothing.
// The view and like routes store views and likes on the live backend
// (20261119172135_post_views_and_likes.sql), but only while
// SHOW_ENGAGEMENT_TOTALS is on (production), and so does the Performance page
// events route (20261121100028_post_performance_stats.sql); if it is switched
// off they too answer 204 without reading the request.
const { databaseClient } = vi.hoisted(() => ({ databaseClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: databaseClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: databaseClient }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: databaseClient,
}));
vi.mock("@/lib/foundation/service-api", () => ({ createFoundationServiceApi: databaseClient }));

import { POST as postEvents } from "@/app/api/analytics/events/route";
import { POST as postVisit } from "@/app/api/analytics/visit/route";
import { POST as postLike } from "@/app/api/engagement/like/route";
import { POST as postShare } from "@/app/api/engagement/share/route";
import { POST as postView } from "@/app/api/engagement/view/route";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import type * as HiddenFeatures from "@/lib/hidden-features";

// The three routes below are tested with SHOW_ENGAGEMENT_TOTALS switched off,
// the branch kept for turning it off again; engagement-routes.test.ts tests
// them switched on. It is on in production (owner's decision of 22 November 2026).
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  SHOW_ENGAGEMENT_TOTALS: false,
}));

const routes = [
  ["/api/analytics/visit", postVisit],
  ["/api/engagement/share", postShare],
] as const;

describe.each(routes)("POST %s", (_path, post) => {
  beforeEach(() => {
    databaseClient.mockReset();
  });

  it("answers 204 with no body, no cookie and no database client", async () => {
    const response = post();

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(databaseClient).not.toHaveBeenCalled();
  });

  it("takes no request, so it cannot read or store what a visitor sends", () => {
    expect(post.length).toBe(0);
  });
});

describe.each([
  ["/api/analytics/events", postEvents],
  ["/api/engagement/like", postLike],
  ["/api/engagement/view", postView],
] as const)("POST %s while the counters are switched off", (path, post) => {
  beforeEach(() => {
    databaseClient.mockReset();
  });

  it("answers 204 without reading the request, a cookie or a database", async () => {
    expect(SHOW_ENGAGEMENT_TOTALS).toBe(false);
    const request = new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ targetId: "00000000-0000-4000-8000-000000000001" }),
    });
    const read = vi.spyOn(request, "text");
    const response = await post(request);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(databaseClient).not.toHaveBeenCalled();
  });
});
