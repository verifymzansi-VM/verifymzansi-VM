import { beforeEach, describe, expect, it, vi } from "vitest";

// Roadmap M2.8: the engagement and analytics beacons called database commands
// that the live backend does not have. They now answer 204 and touch nothing.
const { databaseClient } = vi.hoisted(() => ({ databaseClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: databaseClient,
  tryCreateAdminClient: databaseClient,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: databaseClient }));
vi.mock("@/lib/foundation/restored-browser-client", () => ({
  getRestoredFoundationBrowserClient: databaseClient,
}));

import { POST as postEvents } from "@/app/api/analytics/events/route";
import { POST as postVisit } from "@/app/api/analytics/visit/route";
import { POST as postLike } from "@/app/api/engagement/like/route";
import { POST as postShare } from "@/app/api/engagement/share/route";
import { POST as postView } from "@/app/api/engagement/view/route";

const routes = [
  ["/api/analytics/events", postEvents],
  ["/api/analytics/visit", postVisit],
  ["/api/engagement/like", postLike],
  ["/api/engagement/share", postShare],
  ["/api/engagement/view", postView],
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
