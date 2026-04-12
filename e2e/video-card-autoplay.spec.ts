import { expect, test, type Page } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit media playback under headless CI is unreliable for autoplay assertions.";

type CardRoute = {
  name: string;
  path: string;
  readySelector: string;
  emptySelector?: string;
};

const routes: CardRoute[] = [
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    readySelector:
      '[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]',
    emptySelector: '[data-testid="mzansi-market-grid-empty"]',
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    readySelector:
      '[data-testid="mzansi-business-grid-ready"], [data-testid="mzansi-business-grid-empty"]',
    emptySelector: '[data-testid="mzansi-business-grid-empty"]',
  },
];

async function gotoReady(page: Page, route: CardRoute) {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.locator(route.readySelector).first().waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function installMediaPlaybackShim(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __vmPlayCalls?: number; __vmPlayEvents?: number }).__vmPlayCalls = 0;
    (window as Window & { __vmPlayCalls?: number; __vmPlayEvents?: number }).__vmPlayEvents = 0;

    const playbackState = new WeakMap<HTMLMediaElement, boolean>();

    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return playbackState.get(this as HTMLMediaElement) ?? true;
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function play(this: HTMLMediaElement) {
        playbackState.set(this, false);
        const counters = window as Window & { __vmPlayCalls?: number };
        counters.__vmPlayCalls = (counters.__vmPlayCalls ?? 0) + 1;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: function pause(this: HTMLMediaElement) {
        playbackState.set(this, true);
        this.dispatchEvent(new Event("pause"));
      },
    });

    document.addEventListener(
      "play",
      () => {
        const counters = window as Window & { __vmPlayEvents?: number };
        counters.__vmPlayEvents = (counters.__vmPlayEvents ?? 0) + 1;
      },
      true
    );
  });
}

async function stubCardApiWithVideoData(page: Page, routeName: string) {
  if (routeName === "mzansi-market") {
    await page.route("**/api/listings?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          listings: [
            {
              id: "listing-video-1",
              title: "Autoplay Listing",
              description: "Video listing for autoplay assertion",
              price_cents: 150000,
              price_negotiable: false,
              location_province: "Gauteng",
              location_city: "Johannesburg",
              category: "electronics",
              condition: "used",
              attributes: {},
              created_at: "2026-04-07T00:00:00.000Z",
              photos: ["https://example.com/poster.jpg"],
              videos: ["https://example.com/demo.mp4"],
              video_thumbnail: "https://example.com/poster.jpg",
              logo_url: null,
              boost_until: null,
              featured: false,
              owner_id: "owner-1",
            },
          ],
          sellers: [
            {
              user_id: "owner-1",
              display_name: "Video Seller",
              account_verification_status: "approved",
            },
          ],
          total: 1,
          page: 1,
          limit: 24,
        }),
      });
    });
    return;
  }

  await page.route("**/api/businesses?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        businesses: [
          {
            id: "business-video-1",
            business_type: "standalone_shop",
            business_name: "Autoplay Business",
            description: "Video business card for autoplay assertion",
            cover_photo: "https://example.com/poster.jpg",
            cover_video: "https://example.com/demo.mp4",
            video_thumbnail: "https://example.com/poster.jpg",
            logo_url: null,
            gallery_photos: ["https://example.com/poster.jpg"],
            location_province: "Gauteng",
            location_city: "Johannesburg",
            category: "retail",
            subcategory: null,
            boost_until: null,
            featured_until: null,
            service_areas: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 24,
      }),
    });
  });
}

async function assertVisibleCardVideoAutoplays(page: Page) {
  const videos = page.locator('video[aria-label$="video preview"], video[aria-label*=" video"]');
  const count = await videos.count();
  if (count === 0) {
    test.skip(true, "No video cards available in current fixture data for autoplay assertion.");
  }

  const firstVideo = videos.first();
  await firstVideo.scrollIntoViewIfNeeded();

  // Desktop cards use hover-to-play mode — hover over the card container to
  // trigger playback. The video is inside a parent card wrapper.
  const cardContainer = firstVideo
    .locator("xpath=ancestor::div[contains(@class,'relative')]")
    .first();
  await cardContainer.hover({ timeout: 5_000 }).catch(() => {
    // Hover may fail on mobile viewports — feed mode auto-plays on scroll instead.
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const videoEls = Array.from(document.querySelectorAll("video"));
          const visibleEls = videoEls.filter((video) => {
            const rect = video.getBoundingClientRect();
            return (
              rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
            );
          });

          const hasLoadedSource = visibleEls.some((video) =>
            Boolean(video.currentSrc || video.getAttribute("src"))
          );
          const hasPlaying = visibleEls.some((video) => !video.paused && !video.ended);
          const counters = window as Window & { __vmPlayCalls?: number; __vmPlayEvents?: number };
          const hasPlayCalls =
            (counters.__vmPlayCalls ?? 0) > 0 || (counters.__vmPlayEvents ?? 0) > 0;

          return { hasLoadedSource, hasPlaying, hasPlayCalls, visibleCount: visibleEls.length };
        }),
      { timeout: 12_000 }
    )
    .toEqual(
      expect.objectContaining({
        hasLoadedSource: true,
        hasPlayCalls: true,
      })
    );
}

test.describe("Card video autoplay", () => {
  for (const route of routes) {
    test(`${route.name} autoplays visible card videos`, async ({ page }, testInfo) => {
      test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);

      await installMediaPlaybackShim(page);
      await stubCardApiWithVideoData(page, route.name);

      await gotoReady(page, route);

      if (route.emptySelector && (await page.locator(route.emptySelector).count()) > 0) {
        test.skip(true, `${route.name} is empty in current fixture data.`);
      }

      await assertVisibleCardVideoAutoplays(page);
    });
  }
});
