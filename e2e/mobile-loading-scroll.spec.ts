import { expect, test } from "@playwright/test";

test("hero video waits for an explicit play action", async ({ page }, testInfo) => {
  const videos: string[] = [];
  page.on("request", (request) => {
    if (/\.(mp4|webm)(\?|$)/.test(request.url())) videos.push(request.url());
  });
  await page.goto("/dev/showroom-drag");
  const active = page.locator('[data-showroom-layer="active"]');
  const play = active.getByRole("button", { name: "Play video", exact: true });
  await expect(play).toBeVisible();
  expect(videos).toEqual([]);
  await play.click();
  await expect(active.locator("video")).toHaveAttribute("src", /advertiser-desktop.webm/);
  // WebKit on Windows does not decode this WebM fixture; Chromium also checks delivery.
  if (testInfo.project.name === "mobile-chrome") {
    await expect.poll(() => videos.length).toBeGreaterThan(0);
  }
});

test("vertical touch scrolling crosses the hero without changing slides", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chrome", "Native touch input uses Chromium CDP");
  await page.goto("/dev/showroom-drag");
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
