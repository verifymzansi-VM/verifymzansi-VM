import { expect, test, type Page } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit media playback under headless CI is unreliable for autoplay assertions.";

/**
 * Shim HTMLMediaElement.play/pause so headless browsers can track
 * singleton arbitration without needing real media decoders.
 *
 * Exposes per-element `__vmzState` map and a global log on `window.__vmzLog`.
 */
async function installSingletonMediaShim(page: Page) {
  await page.addInitScript(() => {
    type LogEntry = { id: string; action: "play" | "pause"; ts: number };
    const win = window as unknown as Window & {
      __vmzLog: LogEntry[];
      __vmzLiveCount: () => number;
    };
    win.__vmzLog = [];

    const stateMap = new WeakMap<HTMLMediaElement, boolean>();
    let nextId = 1;
    const idMap = new WeakMap<HTMLMediaElement, string>();

    function elId(el: HTMLMediaElement): string {
      let id = idMap.get(el);
      if (!id) {
        id = `v${nextId++}`;
        idMap.set(el, id);
      }
      return id;
    }

    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return stateMap.get(this as HTMLMediaElement) ?? true;
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function play(this: HTMLMediaElement) {
        stateMap.set(this, false);
        win.__vmzLog.push({ id: elId(this), action: "play", ts: Date.now() });
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: function pause(this: HTMLMediaElement) {
        stateMap.set(this, true);
        win.__vmzLog.push({ id: elId(this), action: "pause", ts: Date.now() });
        this.dispatchEvent(new Event("pause"));
      },
    });

    win.__vmzLiveCount = () => {
      const videos = Array.from(document.querySelectorAll("video"));
      return videos.filter((v) => !v.paused).length;
    };
  });
}

function makeVideoListing(index: number) {
  return {
    id: `video-listing-${index}`,
    title: `Listing ${index}`,
    description: `Listing ${index} description`,
    price_cents: 100_000 * index,
    price_negotiable: false,
    location_province: "Gauteng",
    location_city: "Johannesburg",
    category: "electronics",
    condition: "used",
    attributes: {},
    created_at: `2026-04-07T0${index}:00:00.000Z`,
    photos: [`https://example.com/poster-${index}.jpg`],
    videos: [`https://example.com/video-${index}.mp4`],
    video_thumbnail: `https://example.com/poster-${index}.jpg`,
    logo_url: null,
    boost_until: null,
    featured: false,
    owner_id: `owner-${index}`,
  };
}

async function stubMarketplaceWithMultipleVideos(page: Page, count: number) {
  const listings = Array.from({ length: count }, (_, i) => makeVideoListing(i + 1));
  const sellers = listings.map((l) => ({
    user_id: l.owner_id,
    display_name: `Seller ${l.owner_id}`,
    account_verification_status: "approved",
  }));

  await page.route("**/api/listings?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        listings,
        sellers,
        total: count,
        page: 1,
        limit: 24,
      }),
    });
  });
}

test.describe("Singleton video playback", () => {
  test("at most one video plays at any time on the marketplace grid", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);

    await installSingletonMediaShim(page);
    await stubMarketplaceWithMultipleVideos(page, 3);

    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });

    // Wait for the grid to be ready
    await page
      .locator('[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]')
      .first()
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const videos = page.locator("video");
    const videoCount = await videos.count();
    if (videoCount < 2) {
      test.skip(true, "Need at least 2 video cards to test singleton behavior.");
    }

    // Wait for the arbitration manager to run (debounce is ~100ms)
    await page.waitForTimeout(500);

    // Singleton invariant: at most 1 video should be playing
    const liveCount = await page.evaluate(() =>
      (window as unknown as Window & { __vmzLiveCount: () => number }).__vmzLiveCount()
    );
    expect(liveCount).toBeLessThanOrEqual(1);
  });

  test("playing a second video pauses the first", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);

    await installSingletonMediaShim(page);
    await stubMarketplaceWithMultipleVideos(page, 3);

    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });

    await page
      .locator('[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]')
      .first()
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const videos = page.locator("video");
    const videoCount = await videos.count();
    if (videoCount < 2) {
      test.skip(true, "Need at least 2 video cards to test singleton behavior.");
    }

    // Scroll to ensure multiple videos are in the viewport
    const firstVideo = videos.nth(0);
    const secondVideo = videos.nth(1);
    await firstVideo.scrollIntoViewIfNeeded();

    // Trigger play on the first video via user gesture
    await firstVideo.evaluate((el) => (el as HTMLVideoElement).play());
    await page.waitForTimeout(200);

    // Confirm first video is playing
    const firstPlaying = await firstVideo.evaluate((el) => !(el as HTMLVideoElement).paused);
    expect(firstPlaying).toBe(true);

    // Now scroll the second video into view and trigger play via the manager
    await secondVideo.scrollIntoViewIfNeeded();
    await secondVideo.evaluate((el) => (el as HTMLVideoElement).play());
    await page.waitForTimeout(200);

    // The second should now be playing
    const secondPlaying = await secondVideo.evaluate((el) => !(el as HTMLVideoElement).paused);
    expect(secondPlaying).toBe(true);

    // Global invariant: at most 1 playing
    const liveAfter = await page.evaluate(() =>
      (window as unknown as Window & { __vmzLiveCount: () => number }).__vmzLiveCount()
    );
    expect(liveAfter).toBeLessThanOrEqual(1);

    // Verify the log shows the first video received a pause
    const log = await page.evaluate(() =>
      (
        window as unknown as Window & { __vmzLog: Array<{ id: string; action: string }> }
      ).__vmzLog.map(({ id, action }) => `${id}:${action}`)
    );
    // The first video (v1) should have been paused at some point after the second was played
    const firstId = await firstVideo.evaluate((el) => {
      const videos = Array.from(document.querySelectorAll("video"));
      return `v${videos.indexOf(el as HTMLVideoElement) + 1}`;
    });
    const hasPauseForFirst = log.some((entry) => entry === `${firstId}:pause`);
    expect(hasPauseForFirst).toBe(true);
  });

  test("singleton invariant holds after scrolling through many cards", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);

    await installSingletonMediaShim(page);
    // Larger set so scrolling reveals new videos
    await stubMarketplaceWithMultipleVideos(page, 6);

    await page.goto("/mzansi-market", { waitUntil: "domcontentloaded" });

    await page
      .locator('[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]')
      .first()
      .waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const videos = page.locator("video");
    const videoCount = await videos.count();
    if (videoCount < 3) {
      test.skip(true, "Need at least 3 video cards to test scroll singleton behavior.");
    }

    // Scroll through each video element, pausing briefly for the IO + debounce
    for (let i = 0; i < videoCount; i++) {
      await videos.nth(i).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      const live = await page.evaluate(() =>
        (window as unknown as Window & { __vmzLiveCount: () => number }).__vmzLiveCount()
      );
      expect(live, `After scrolling to video ${i + 1}`).toBeLessThanOrEqual(1);
    }
  });
});
