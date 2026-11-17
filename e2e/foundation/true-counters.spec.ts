import { expect, test, type Page } from "@playwright/test";
import { readServerLogEntries, readTestCopy, type TestCopy } from "./support/test-copy";

// Roadmap M2.8: counters and chips show only true facts. The live backend does
// not store views or likes and does not order showrooms by province, so post
// pages show no view count and no like button, the showroom shows no "Showing
// <province> first" chip, and the engagement and analytics beacons answer 204
// without calling the missing database commands (which used to log errors).

const BEACONS = [
  "/api/analytics/visit",
  "/api/analytics/events",
  "/api/engagement/view",
  "/api/engagement/like",
  "/api/engagement/share",
];
/** What these routes logged while they called the missing commands. */
const BEACON_ERRORS = [
  "Failed to record site visit",
  "Unexpected site visit error",
  "Failed to toggle content like",
  "Unexpected engagement like error",
  "Failed to record content views",
  "Unexpected engagement view error",
  "Analytics events not recorded",
  "Analytics route error",
];
const LEGACY_CLIENT_EVENT = "legacy_client_in_foundation";

/** Seeded posts (fixture/posts.json) and the page each one opens on. */
const POSTS = [
  { title: "Fixture Mzansi Motor Workshop", path: "/mzansi-business/" },
  { title: "Fixture Soweto Craft Market", path: "/tourism-events/" },
];

function beaconLogLines() {
  const errors = BEACON_ERRORS.flatMap((message) => readServerLogEntries(message));
  const legacy = readServerLogEntries(LEGACY_CLIENT_EVENT).filter((entry) =>
    BEACONS.includes(String(entry.meta?.route))
  );
  return errors.length + legacy.length;
}

/** Statuses of the beacons this page sent, by path. */
function watchBeacons(page: Page) {
  const seen: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (BEACONS.includes(pathname)) seen.push({ path: pathname, status: response.status() });
  });
  return seen;
}

let state: TestCopy;

test.describe("counters and chips show only true facts", () => {
  test.beforeAll(() => {
    state = readTestCopy();
  });

  for (const post of POSTS) {
    test(`${post.title}: no view count, like button or like total`, async ({ page }) => {
      const id = state.posts.find((candidate) => candidate.title === post.title)?.id;
      expect(id).toBeTruthy();
      const logLines = beaconLogLines();
      const beacons = watchBeacons(page);

      await page.goto(`${post.path}${id}`);
      // Wide screens open the full-screen viewer over the page; wait for the choice.
      await expect(page.locator("[data-immersive-pending]")).toHaveCount(0);
      await expect(page.getByText(post.title).filter({ visible: true }).first()).toBeVisible();

      // Anywhere in the document, visible or not (screen-reader text included).
      await expect(page.getByText(/\b\d[\d,.\s]*k?\s+views?\b/i)).toHaveCount(0);
      await expect(page.locator(".viewer-action-label", { hasText: /^Views$/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /like this/i })).toHaveCount(0);

      // The page's own beacons go out at once (visit) or after a 1 s batch delay
      // (views, impressions); give them time to reach the server and return.
      await page.waitForTimeout(2_500);
      for (const beacon of beacons) expect(beacon, beacon.path).toMatchObject({ status: 204 });
      expect(beaconLogLines()).toBe(logLines);
    });
  }

  test("the home showroom has no province chip", async ({ page }) => {
    await page.goto("/");
    const showroom = page.locator("section", { has: page.locator("#home-showroom-title") });
    await expect(showroom.getByText(state.posts[0].title).first()).toBeAttached();
    await expect(page.getByText(/^Showing (all of South Africa|.+ first)$/)).toHaveCount(0);
    await expect(page.getByLabel("Show posts from a province first")).toHaveCount(0);
  });

  test("the engagement and analytics routes answer 204 and log nothing", async ({
    request,
    baseURL,
  }) => {
    const logLines = beaconLogLines();
    const id = state.posts[0].id;
    const bodies: Record<string, unknown> = {
      "/api/analytics/visit": { path: "/", referrer: null },
      "/api/analytics/events": {
        events: [{ table: "businesses", id, type: "detail_view", surface: "detail" }],
      },
      "/api/engagement/view": {
        events: [{ type: "business", id, source: "page", surface: "detail" }],
      },
      "/api/engagement/like": { targetId: id, targetType: "business" },
      "/api/engagement/share": { targetId: id, targetType: "business" },
    };
    for (const path of BEACONS) {
      const response = await request.post(path, {
        headers: { origin: String(baseURL) },
        data: bodies[path],
      });
      expect(response.status(), path).toBe(204);
      expect(await response.text(), path).toBe("");
      expect(response.headers()["set-cookie"], path).toBeUndefined();
    }
    expect(beaconLogLines()).toBe(logLines);
  });
});
