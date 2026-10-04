import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { buildFixtureSlides } from "../src/app/dev/immersive/fixtures";

const slides = buildFixtureSlides();
const market = slides.filter((slide) => slide.vertical === "market");
const business = slides.filter((slide) => slide.vertical === "business");

const sizes = [
  [360, 640],
  [390, 844],
  [640, 360],
];

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

/** A touch swipe on the stage, as a phone would send it. */
async function swipe(page: Page, from: [number, number], to: [number, number]) {
  await page.locator(".vm-stage").evaluate(
    async (stage, [start, end]) => {
      const fire = (type: string, x: number, y: number) =>
        stage.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 11,
            pointerType: "touch",
            isPrimary: true,
            clientX: x,
            clientY: y,
            bubbles: true,
          })
        );
      fire("pointerdown", start[0], start[1]);
      for (let step = 1; step <= 6; step++) {
        fire(
          "pointermove",
          start[0] + ((end[0] - start[0]) * step) / 6,
          start[1] + ((end[1] - start[1]) * step) / 6
        );
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      fire("pointerup", end[0], end[1]);
    },
    [from, to] as const
  );
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "Video mode is for phones and tablets");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://images.unsplash.com/**", (route) =>
    route.fulfill({
      path: path.resolve("public/images/showrooms/tourism-v2-desktop.avif"),
      contentType: "image/avif",
    })
  );
  await page.route("**/api/engagement/like", (route) =>
    route.fulfill({ json: { liked: true, likeCount: 248 } })
  );
});

for (const [width, height] of sizes) {
  test(`rails, post info and media fit without overlap at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/video-mode");
    await expect(heading(page)).toHaveText(market[0].title);
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      };
      return {
        sections: box(".vm-sections"),
        info: box(".vm-info"),
        actions: box(".vm-actions"),
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    expect(boxes.pageWidth).toBeLessThanOrEqual(width);
    expect(boxes.info.right).toBeLessThanOrEqual(boxes.actions.left);
    // The post info never sits under the section rail.
    const besideRail = boxes.info.left >= boxes.sections.right;
    const belowRail = boxes.info.top >= boxes.sections.bottom;
    expect(besideRail || belowRail).toBe(true);
    for (const rail of [boxes.actions, boxes.sections]) {
      expect(rail.top).toBeGreaterThanOrEqual(0);
      expect(rail.bottom).toBeLessThanOrEqual(height);
    }
    // Every control is at least 44px for a thumb.
    const small = await page
      .locator(".vm-actions button, .vm-actions a, nav[aria-label='Sections'] button")
      .evaluateAll(
        (elements) =>
          elements
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width < 44 || rect.height < 44).length
      );
    expect(small).toBe(0);
  });
}

test("swipes move between posts and media; the edge is left to the system", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);

  await swipe(page, [195, 600], [195, 200]);
  await expect(heading(page)).toHaveText(market[1].title);
  await expect(page).toHaveURL(new RegExp(`post=${market[1].id}`));

  await swipe(page, [300, 400], [80, 400]);
  await expect(page).toHaveURL(/m=1/);

  // Sideways from the very edge belongs to the phone's back gesture.
  await swipe(page, [4, 400], [250, 400]);
  await expect(page).toHaveURL(/m=1/);

  await swipe(page, [195, 200], [195, 600]);
  await expect(heading(page)).toHaveText(market[0].title);
});

test("sections, Tourism choices and the end card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await page.getByRole("button", { name: "Business", exact: true }).click();
  await expect(heading(page)).toHaveText(business[0].title);
  await expect(page).toHaveURL(/v=business/);

  await page.getByRole("button", { name: "Tourism and events", exact: true }).click();
  await page.getByRole("button", { name: /Tourism and events: showing tourism/ }).click();
  await page.getByRole("radio", { name: "Events" }).click();
  await expect(page).toHaveURL(/kind=events/);

  // One event in the demo: the next swipe reaches the end card, with ways onward.
  await swipe(page, [195, 600], [195, 200]);
  await expect(page.getByRole("heading", { name: "You’re all caught up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  // The card is centred; it offers the other sections, so the section rail steps away.
  const margins = await page
    .getByRole("heading", { name: "You’re all caught up" })
    .evaluate((element) => {
      const rect = element.closest("[role='status']")!.getBoundingClientRect();
      return [rect.left, window.innerWidth - rect.right];
    });
  expect(Math.abs(margins[0] - margins[1])).toBeLessThanOrEqual(1);
  await expect(page.locator(".vm-sections")).toHaveCount(0);
  await page.getByRole("button", { name: "Mzansi Market" }).click();
  await expect(heading(page)).toHaveText(market[0].title);
});

test("the edge tab sends every control out and back; swiping still works", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const root = page.locator("[data-chrome]");
  await expect(root).toHaveAttribute("data-chrome", "shown");

  await page.getByRole("button", { name: "Hide controls" }).click();
  await expect(root).toHaveAttribute("data-chrome", "hidden");
  // Hidden controls cannot be reached by touch, keyboard or screen readers.
  await expect(page.locator("[data-vm-chrome][inert]")).toHaveCount(4);

  await swipe(page, [195, 600], [195, 200]);
  await expect(page).toHaveURL(new RegExp(`post=${market[1].id}`));
  await expect(root).toHaveAttribute("data-chrome", "hidden");

  await page.getByRole("button", { name: "Show post details and controls" }).click();
  await expect(root).toHaveAttribute("data-chrome", "shown");
  await expect(heading(page)).toHaveText(market[1].title);
});

test("controls step aside on their own after a quiet moment", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const root = page.locator("[data-chrome]");
  await page.clock.fastForward(3000);
  await expect(root).toHaveAttribute("data-chrome", "shown");
  await page.clock.fastForward(3500);
  await expect(root).toHaveAttribute("data-chrome", "hidden");
});

test("Back closes a sheet before it leaves Video mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/dev\/video-mode/);
  await expect(heading(page)).toHaveText(market[0].title);
});

test("enquiry opens as a bottom sheet and holds the video", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await page.getByRole("button", { name: "Send a private enquiry" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(843);
  await expect
    .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(true);
});

test("has no detectable accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const results = await new AxeBuilder({ page })
    .include("[aria-roledescription='video mode']")
    .analyze();
  expect(results.violations).toEqual([]);
});

test("pulling the liquid tab off the wall switches; a nudge does not", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const root = page.locator("[data-chrome]");
  const pull = (distance: number) =>
    page.locator(".vm-edge-tab").evaluate(async (tab, length) => {
      const rect = tab.getBoundingClientRect();
      const x = rect.right - 10;
      const y = rect.top + rect.height / 2;
      const fire = (type: string, clientX: number) =>
        tab.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 31,
            pointerType: "touch",
            isPrimary: true,
            clientX,
            clientY: y,
            bubbles: true,
          })
        );
      fire("pointerdown", x);
      for (let step = 1; step <= 8; step++) {
        fire("pointermove", x - (length * step) / 8);
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      fire("pointerup", x - length);
      // The browser's own click after a drag is ignored by the tab.
      (tab as HTMLButtonElement).click();
    }, distance);

  await pull(12);
  await expect(root).toHaveAttribute("data-chrome", "shown");
  await pull(70);
  await expect(root).toHaveAttribute("data-chrome", "hidden");
});

test("pausing a video brings the post's details back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const root = page.locator("[data-chrome]");
  await page.getByRole("button", { name: "Hide controls" }).click();
  await expect(root).toHaveAttribute("data-chrome", "hidden");
  await page.getByRole("button", { name: "Pause video" }).click();
  await expect(root).toHaveAttribute("data-chrome", "shown");
});

test("tickets stay in view and are not repeated under More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode?v=tourism&kind=events");
  const tickets = page.getByRole("link", { name: "Get tickets" });
  await expect(tickets).toBeVisible();
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Get tickets" })).toHaveCount(0);
});

test("after the visitor shows the details themselves, they no longer hide on their own", async ({
  page,
}) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/video-mode");
  await expect(heading(page)).toHaveText(market[0].title);
  const root = page.locator("[data-chrome]");
  await page.clock.fastForward(6500);
  await expect(root).toHaveAttribute("data-chrome", "hidden");
  await page.getByRole("button", { name: "Show post details and controls" }).click();
  await expect(root).toHaveAttribute("data-chrome", "shown");
  await page.clock.fastForward(20000);
  await expect(root).toHaveAttribute("data-chrome", "shown");
});

for (const [path, label] of [
  ["/mzansi-market", "Open listing filters"],
  ["/mzansi-business", "Open business filters"],
  ["/tourism-events", "Open tourism and events filters"],
] as const) {
  test(`filters sit on the right wall and open from there on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const tab = page.getByRole("button", { name: new RegExp(`^${label}`) });
    await expect(tab).toBeVisible();
    const box = await tab.boundingBox();
    expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(390);
    await tab.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}
