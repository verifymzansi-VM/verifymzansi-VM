import { expect, test, type Page } from "@playwright/test";

type MediaRoute = {
  name: string;
  path: string;
  readySelector: string;
  apiPattern: string;
  apiPath: string;
  body: unknown;
};

const routes: MediaRoute[] = [
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    readySelector: 'a[href^="/listing/"]',
    apiPattern: "**/api/listings**",
    apiPath: "/api/listings",
    body: {
      listings: [
        {
          id: "listing-fit-1",
          title: "Wide Listing Media",
          description: "Wide media should remain fully visible in the card.",
          price_cents: 150000,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          category: "electronics",
          condition: "used",
          attributes: {},
          created_at: "2026-04-07T00:00:00.000Z",
          photos: ["/images/promo/promo-1.png"],
          videos: ["/images/promo/advertiser-mobile.webm"],
          video_thumbnail: "/images/promo/promo-2.png",
          logo_url: "/images/logo.png",
          boost_until: null,
          featured: false,
          owner_id: "owner-1",
          media_width: 1920,
          media_height: 640,
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
    },
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    readySelector: 'a[href^="/mzansi-business/"]',
    apiPattern: "**/api/businesses**",
    apiPath: "/api/businesses",
    body: {
      businesses: [
        {
          id: "business-fit-1",
          business_type: "standalone_shop",
          business_name: "Tall Business Media",
          description: "Tall media should remain fully visible in the card.",
          cover_photo: "/images/promo/promo-3.png",
          cover_video: "/images/promo/advertiser-mobile.webm",
          video_thumbnail: "/images/promo/promo-4.png",
          logo_url: "/images/logo.png",
          gallery_photos: ["/images/promo/promo-5.png"],
          location_province: "Gauteng",
          location_city: "Johannesburg",
          category: "retail",
          subcategory: null,
          boost_until: null,
          featured_until: null,
          service_areas: null,
          media_width: 720,
          media_height: 1600,
        },
      ],
      total: 1,
      page: 1,
      limit: 24,
    },
  },
  {
    name: "promotions",
    path: "/tourism-events?tab=events&type=event",
    readySelector: 'a[href^="/tourism-events/"]',
    apiPattern: "**/api/promotions**",
    apiPath: "/api/promotions",
    body: {
      promotions: [
        {
          id: "promotion-fit-1",
          title: "Wide Promotion Media",
          description: "Wide promotion media should remain fully visible in the card.",
          promotion_type: "event",
          category: "festival_concert",
          category_key: "festival_concert",
          photos: ["/images/promo/promo-6.png"],
          videos: ["/images/promo/advertiser-mobile.webm"],
          video_thumbnail: "/images/promo/promo-2.png",
          focal_x: null,
          focal_y: null,
          media_width: 2048,
          media_height: 768,
          logo_url: "/images/logo.png",
          price_cents: 9900,
          price_negotiable: false,
          location_province: "Gauteng",
          location_city: "Johannesburg",
          boost_until: null,
          featured_until: null,
          business_id: "business-fit-1",
          created_at: "2026-04-07T00:00:00.000Z",
          start_date: "2026-05-01T08:00:00.000Z",
          end_date: "2026-05-01T18:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 24,
    },
  },
];

async function gotoReady(page: Page, route: MediaRoute) {
  await page.addInitScript(
    ({ apiPath, body }) => {
      const originalFetch = window.fetch.bind(window);

      window.fetch = async (input, init) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof Request ? input.url : String(input);

        if (requestUrl.includes(apiPath)) {
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }

        return originalFetch(input, init);
      };
    },
    { apiPath: route.apiPath, body: route.body }
  );

  await page.route(route.apiPattern, async (request) => {
    await request.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(route.body),
    });
  });

  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.locator(route.readySelector).first().waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("Card media fit compliance", () => {
  for (const route of routes) {
    test(`${route.name} keeps first card media fully visible`, async ({ page }) => {
      await gotoReady(page, route);

      const media = page
        .locator("img[data-media-fit]:visible, video[data-media-fit]:visible")
        .first();
      await expect(media).toBeVisible();
      await expect(media).toHaveAttribute("data-media-fit", /smart/);

      await expect
        .poll(
          async () =>
            media.evaluate((element) => {
              const style = window.getComputedStyle(element);
              return {
                objectFit: style.objectFit,
                className: element.className,
              };
            }),
          { timeout: 10_000 }
        )
        .toEqual(
          expect.objectContaining({
            objectFit: "contain",
          })
        );
    });
  }
});
