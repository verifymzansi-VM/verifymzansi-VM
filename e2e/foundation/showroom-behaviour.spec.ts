import { expect, test, type Locator } from "@playwright/test";

// Showroom behaviour of the restored website in foundation mode, moved from
// the stub suite (PORTING.md): the area showrooms as a visitor sees them with
// the copy's seeded posts (marketplace-showroom-smoke, promotions-showroom,
// showroom-cta-touch-target), and the carousel and rail on their fixed browser
// test pages /dev/showroom-drag and /dev/rail-drag, which exist only in test
// mode (showroom-desktop-drag, rail-desktop-drag, showroom-loading-stability,
// mobile-loading-scroll). Nothing here writes to the test copy.

const areas = [
  { name: "mzansi-market", path: "/mzansi-market", heading: /^mzansi market$/i },
  { name: "mzansi-business", path: "/mzansi-business", heading: /mzansi business/i },
  { name: "tourism-events", path: "/tourism-events", heading: /tourism & events/i },
] as const;

const isMobileProject = (name: string) => name === "mobile-chrome" || name === "mobile-safari";

const readFrames = (slides: Locator) =>
  slides.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        z: Number(style.zIndex),
      };
    })
  );

test.describe("area showrooms", () => {
  for (const area of areas) {
    test(`${area.name} renders its showroom without runtime errors`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "This smoke runs in Chromium only.");
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto(area.path, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: area.heading }).first()).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => {});

      const showroom = page.locator("section[aria-roledescription='carousel']").first();
      await expect(showroom).toBeVisible();
      const card = showroom.getByRole("link").first();
      await expect(card).toBeVisible();
      const [cardBox, viewportHeight] = await Promise.all([
        card.boundingBox(),
        page.evaluate(() => window.innerHeight),
      ]);
      expect(cardBox).not.toBeNull();
      expect(cardBox!.y).toBeGreaterThanOrEqual(0);
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(viewportHeight);

      expect(
        consoleErrors.filter((message) =>
          /hydration|runtime|typeerror|referenceerror|server rendered html didn't match/i.test(
            message
          )
        )
      ).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const area of areas) {
    test(`${area.name} showroom card stays touch-friendly`, async ({ page }, testInfo) => {
      test.skip(!isMobileProject(testInfo.project.name), "Runs only on mobile projects.");
      await page.goto(area.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      const showroom = page.locator("section[aria-roledescription='carousel']").first();
      await expect(showroom).toBeVisible();
      const card = showroom.getByRole("link").first();
      await expect(card).toBeVisible();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  }

  test("Tourism & Events shows its showroom and the Events tab works", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto("/tourism-events", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Tourism & Events" })).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});

    const showroom = page.locator("section[aria-roledescription='carousel']").first();
    await expect(showroom).toBeVisible();
    await expect(showroom.getByRole("link").first()).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "Tourism & Events sections" });
    await expect(tablist).toBeVisible();
    // "All" (stays, places and events together) is the default tab.
    const allTab = tablist.getByRole("tab", { name: "All", exact: true });
    const tourismTab = tablist.getByRole("tab", { name: "Tourism", exact: true });
    const eventsTab = tablist.getByRole("tab", { name: "Events", exact: true });
    await expect(allTab).toHaveAttribute("aria-selected", "true");
    await expect(tourismTab).toHaveAttribute("aria-selected", "false");
    await expect(eventsTab).toHaveAttribute("aria-selected", "false");

    // A click before hydration does nothing; click again until the tab is chosen.
    await expect(async () => {
      if ((await eventsTab.getAttribute("aria-selected")) !== "true")
        await eventsTab.click({ timeout: 2_000 });
      await expect(eventsTab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await expect(page.getByRole("link", { name: /list an event/i }).first()).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: /event|loading events/i })
    ).toBeVisible();
    expect(
      consoleErrors.filter((message) => /hydration|runtime|typeerror|referenceerror/i.test(message))
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("showroom carousel on its test page", () => {
  const routePath = "/dev/showroom-drag";

  test("dragging a card with the mouse turns the carousel without opening the card", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop drag coverage runs in Chromium only.");
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const showroom = page.locator("section[aria-roledescription='carousel']").first();
    await expect(showroom).toBeVisible();
    const liveRegion = showroom.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toContainText("Slide 1 of");

    // Ambient videos stay poster-first until an explicit play action
    // (deferVideoLoadUntilPlay), so start playback before checking delivery.
    const activeCard = showroom.locator('[data-showroom-layer="active"]').first();
    const playButton = activeCard.getByRole("button", { name: "Play video", exact: true });
    await expect(playButton).toBeVisible();
    await playButton.click();
    await expect(showroom.locator("video").first()).toHaveAttribute(
      "src",
      /advertiser-desktop\.webm$/
    );

    const cardLink = showroom.getByRole("link", { name: /^Open / }).first();
    await expect(cardLink).toBeVisible();
    const box = await cardLink.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 160, startY, { steps: 10 });
    await expect(liveRegion).toContainText("Slide 1 of");
    await page.mouse.up();
    await expect(liveRegion).toContainText("Slide 2 of");
    expect(new URL(page.url()).pathname).toBe(routePath);
  });

  test("a short mouse drag settles back without changing slides", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop drag coverage runs in Chromium only.");
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const showroom = page.locator("section[aria-roledescription='carousel']").first();
    await expect(showroom).toBeVisible();
    const liveRegion = showroom.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toContainText("Slide 1 of");
    const cardLink = showroom.getByRole("link", { name: /^Open / }).first();
    await expect(cardLink).toBeVisible();
    const box = await cardLink.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 24, startY, { steps: 4 });
    await page.mouse.up();
    await expect(liveRegion).toContainText("Slide 1 of");
    expect(new URL(page.url()).pathname).toBe(routePath);
  });

  test("the hero video waits for an explicit play action", async ({ page }, testInfo) => {
    const videos: string[] = [];
    page.on("request", (request) => {
      if (/\.(mp4|webm)(\?|$)/.test(request.url())) videos.push(request.url());
    });
    await page.goto(routePath);
    const active = page.locator('[data-showroom-layer="active"]');
    // The carousel's layout effect has run: the page is hydrated.
    await expect(page.locator("[data-showroom-index]").first()).toHaveAttribute(
      "style",
      /(?:^|;)\s*transform:/
    );
    const play = active.getByRole("button", { name: "Play video", exact: true });
    await expect(play).toBeVisible();
    expect(videos).toEqual([]);
    await play.click();
    await expect(active.locator("video")).toHaveAttribute("src", /advertiser-desktop.webm/);
    if (testInfo.project.name === "mobile-chrome")
      await expect.poll(() => videos.length).toBeGreaterThan(0);
  });

  test("vertical touch scrolling crosses the hero without changing slides", async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "Native touch input uses Chromium CDP");
    await page.goto(routePath);
    // Give the isolated carousel fixture the same scrollable space as a long page.
    await page.locator("main").evaluate((main) => {
      const spacer = document.createElement("div");
      spacer.style.height = "2000px";
      main.appendChild(spacer);
    });
    const hero = page.getByLabel("Carousel slides", { exact: true }).first();
    await expect(hero).toBeVisible();
    const cdp = await context.newCDPSession(page);
    const swipe = async (x: number, y: number) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 10; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x - step * 3, y: y - step * 22 }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const box = (await hero.boundingBox())!;
    await swipe(box.x + box.width / 2, Math.min(box.y + box.height - 30, 650));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
    await expect(page.getByText("Slide 1 of 3", { exact: true })).toBeAttached();
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 820, height: 1180 },
    { width: 1440, height: 900 },
  ]) {
    test(`the carousel is stable before hydration at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(routePath);
      const slides = page.locator("[data-showroom-index]");
      // Inline transforms are installed by the carousel's layout effect.
      await expect(slides.first()).toHaveAttribute("style", /(?:^|;)\s*transform:/);
      const hydratedFrames = await readFrames(slides);
      const image = slides.nth(1).getByAltText("Drag Test Two", { exact: true });
      const originalImage = await image.elementHandle();
      await page.getByLabel("Carousel slides", { exact: true }).press("ArrowRight");
      await expect(page.getByText("Slide 2 of 3", { exact: true })).toBeAttached();
      expect(await image.evaluate((element, original) => element === original, originalImage)).toBe(
        true
      );
      await expect(image).toHaveCSS("opacity", "1");

      // Keep streaming HTML scripts but block the app: CSS and images must stand alone.
      await page.route("**/_next/**/*.js", (route) => route.abort());
      await page.reload();
      await expect(slides.first()).toBeVisible();
      const initial = await readFrames(slides);
      expect(initial).toHaveLength(3);
      expect(initial[0].z).toBeGreaterThan(initial[1].z);
      expect(initial[0].z).toBeGreaterThan(initial[2].z);
      expect(initial[1].width).toBeLessThan(initial[0].width);
      expect(initial[0].x + initial[0].width / 2).toBeCloseTo(viewport.width / 2, 0);
      await expect(image).toHaveCSS("opacity", "1");
      await expect(slides.nth(1).locator(".skeleton-shimmer")).toHaveCount(0);
      for (let i = 0; i < initial.length; i++) {
        for (const key of ["x", "y", "width", "height"] as const) {
          expect(initial[i][key]).toBeCloseTo(hydratedFrames[i][key], 0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  }
});

test.describe("showcase rail on its test page", () => {
  test("dragging a rail card with the mouse scrolls before release and does not open it", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop drag coverage runs in Chromium only.");
    const routePath = "/dev/rail-drag";
    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const rail = page.getByLabel("Rail drag showcase");
    await expect(rail).toBeVisible();
    const cardLink = rail.getByRole("link", { name: /rail test one/i }).first();
    await expect(cardLink).toBeVisible();
    await rail.evaluate((node) => {
      node.scrollLeft = 0;
    });
    expect(await rail.evaluate((node) => node.scrollLeft)).toBe(0);
    const box = await cardLink.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 160, startY, { steps: 10 });
    await expect.poll(async () => rail.evaluate((node) => node.scrollLeft)).toBeGreaterThan(40);
    await page.mouse.up();
    expect(new URL(page.url()).pathname).toBe(routePath);
  });
});
