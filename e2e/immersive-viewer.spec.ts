import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFixtureSlides } from "../src/app/dev/immersive/fixtures";
import { encodeRef, slideRef } from "../src/lib/feed/refs";
import AxeBuilder from "@axe-core/playwright";

const slides = buildFixtureSlides();
const dimensions = [
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
];
const active = (page: Page) =>
  page
    .locator(".viewer-slide")
    .filter({ has: page.getByRole("navigation", { name: "Move between profiles" }) });

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, "The viewer is desktop-only");
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Deterministic local imagery keeps this suite independent of an image provider.
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

for (const [width, height] of dimensions) {
  test(`all profile types fit both themes at ${width}×${height}`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/immersive");
    await expect(page.getByRole("button", { name: "Next profile", exact: true })).toBeEnabled();
    for (const theme of ["dark", "light"]) {
      if (theme === "light")
        await page.getByRole("button", { name: "Switch to light mode" }).click();
      for (let index = 0; index < 4; index++) {
        await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(
          slides[index].title
        );
        const profileNavigation = page.getByRole("navigation", { name: "Move between profiles" });
        await expect(profileNavigation).toHaveText("");
        await expect(page.getByText("Auto media", { exact: true })).toHaveCount(0);
        for (const label of ["Previous profile", "Next profile"]) {
          const circle = await profileNavigation
            .getByRole("button", { name: label, exact: true })
            .evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return {
                width: rect.width,
                height: rect.height,
                radius: getComputedStyle(element).borderRadius,
              };
            });
          expect(circle.width).toBe(56);
          expect(circle.height).toBe(56);
          expect(parseFloat(circle.radius)).toBeGreaterThanOrEqual(28);
        }
        const geometry = await active(page).evaluate((element) => {
          const frame = element.querySelector("[data-viewer-media]")!.getBoundingClientRect();
          const rail = element.querySelector(".viewer-rail")!.getBoundingClientRect();
          const panels = [...element.querySelectorAll("[data-feed-panel]")].map((panel) =>
            panel.getBoundingClientRect()
          );
          return {
            frame: {
              x: frame.x,
              y: frame.y,
              width: frame.width,
              height: frame.height,
              bottom: frame.bottom,
            },
            rail: { x: rail.x, right: rail.right },
            panels: panels.map((panel) => ({
              x: panel.x,
              right: panel.right,
              height: panel.height,
            })),
            viewport: innerWidth,
          };
        });
        expect(geometry.frame.width / geometry.frame.height).toBeCloseTo(9 / 16, 2);
        expect(geometry.frame.y).toBe(0);
        expect(geometry.frame.bottom).toBe(height);
        expect(geometry.rail.x).toBeGreaterThanOrEqual(geometry.frame.x + geometry.frame.width);
        expect(geometry.rail.right).toBeLessThanOrEqual(width);
        for (const panel of geometry.panels) {
          expect(panel.x).toBeGreaterThanOrEqual(0);
          expect(panel.right).toBeLessThanOrEqual(width);
          expect(Math.abs(panel.height - (geometry.frame.height - 16))).toBeLessThan(1);
        }
        const toolbar = await page
          .locator('[aria-label="Profile browsing tools"]')
          .evaluate((element) => {
            const children = [...element.querySelectorAll(".viewer-tool-slot")].map((node) =>
              node.getBoundingClientRect()
            );
            return children.map((box) => ({
              x: box.x,
              right: box.right,
              bottom: box.bottom,
              height: box.height,
            }));
          });
        for (const box of toolbar) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(64);
          expect(box.bottom).toBeLessThanOrEqual(height);
          expect(box.height).toBeGreaterThanOrEqual(32); // Brand mark; controls are 44px.
        }
        if (index === 0 && width === 1920) {
          expect(geometry.frame.width).toBeCloseTo(607.5, 1);
          if (browserName === "chromium")
            await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
          if (browserName === "chromium")
            await page.screenshot({ path: `output/desktop-profiles/${theme}.png` });
        }
        if (width === 1920 && browserName === "chromium") {
          await page.screenshot({
            path: `output/desktop-profiles/${theme}-${slides[index].kind}.png`,
          });
        }
        if (index < 3)
          await page.getByRole("button", { name: "Next profile", exact: true }).click();
      }
      for (let step = 0; step < 3; step++)
        await page.getByRole("button", { name: "Previous profile", exact: true }).click();
    }
  });
}

test("tab focus, independent appearance, portalled filters, and discarded drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/dev/immersive");
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  await overview.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Contact and details" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(overview).toBeFocused();
  const siteTheme = await page.locator("html").getAttribute("class");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("class", siteTheme!);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-viewer-theme", "light");
  await page.getByRole("searchbox").fill("Unsaved search");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
});

test("toolbar icons expand on hover and keyboard focus without moving the media", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/dev/immersive");
  await expect(page.getByRole("button", { name: "Next profile", exact: true })).toBeEnabled();
  const frame = active(page).locator("[data-viewer-media]");
  const originalFrame = await frame.boundingBox();
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "Switch to light mode" }).click();
    const toolbar = page.getByRole("complementary", { name: "Profile browsing tools" });
    for (const name of ["Market", "Business", "Tourism & Events", "Filters"]) {
      const control = toolbar.getByRole("button", { name, exact: true });
      await control.hover();
      await expect(control.locator(".viewer-tool-label")).toBeVisible();
      await expect.poll(async () => (await control.boundingBox())!.width).toBeGreaterThan(90);
      expect(await frame.boundingBox()).toEqual(originalFrame);
      await page.mouse.move(900, 400);
      await expect.poll(async () => (await control.boundingBox())!.width).toBe(44);
    }
    const province = toolbar
      .locator(".viewer-tool")
      .filter({ has: page.getByLabel("Show posts from") });
    await province.hover();
    await expect(province.locator(".viewer-tool-label")).toHaveText("All of South Africa");
    await expect.poll(async () => (await province.boundingBox())!.width).toBeGreaterThan(90);
    await page.mouse.move(900, 400);
    await toolbar.getByRole("link", { name: "VerifyMzansi home" }).focus();
    await page.keyboard.press("Tab");
    await expect(toolbar.getByRole("button", { name: "Market", exact: true })).toBeFocused();
    await expect
      .poll(
        async () =>
          (await toolbar.getByRole("button", { name: "Market", exact: true }).boundingBox())!.width
      )
      .toBeGreaterThan(90);
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await page.screenshot({ path: `output/desktop-profiles/${theme}-hover-labels.png` });
    await toolbar.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await frame.boundingBox()).toEqual(originalFrame);
  }
});

test("panel scrolling and dialogs keep the profile, and playback stays exclusive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/dev/immersive");
  await expect(page.getByRole("button", { name: "Next profile", exact: true })).toBeEnabled();
  await expect(page.locator("video")).toHaveCount(1);
  await active(page).locator("[data-feed-panel]").first().hover();
  await page.mouse.wheel(0, 500);
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[0].title);
  await page.getByRole("button", { name: "Send an enquiry", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-viewer-theme", "dark");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("data-viewer-theme", "light");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Auto media", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next profile", exact: true }).click();
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[1].title);
  await expect(page.locator("video")).toHaveCount(1);
});

test("message rail opens a private enquiry and action labels stay plain", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/dev/immersive");
  const actions = page.getByRole("group", { name: "Post actions" });
  const message = actions.getByRole("button", { name: "Message account holder" });
  await message.hover();
  await expect(message.locator(".viewer-action-label")).toHaveCSS("opacity", "1");
  await expect(message).not.toHaveAttribute("title");
  await message.click();
  await expect(page.getByRole("dialog")).toContainText(
    "This message is private and will not appear on the profile"
  );
  await expect(page.getByRole("dialog").getByLabel("Your message")).toBeVisible();
  await page.keyboard.press("Escape");
  const share = actions.getByRole("button", { name: "Share this post" });
  await expect(share).toContainText("0");
  await share.hover();
  await expect(share.locator(".viewer-action-label")).toHaveCSS("opacity", "1");
  await expect(share).not.toHaveAttribute("title");
  await page.getByRole("button", { name: "Next profile", exact: true }).click();
  const directions = actions.getByRole("link", { name: /in maps/ });
  await expect(directions).toHaveAttribute("href", slides[1].mapUrl!);
  await expect(actions.getByRole("button", { name: /comment/i })).toHaveCount(0);
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await directions.hover();
  await page.screenshot({ path: "output/desktop-profiles/private-message-rail.png" });
});

test("both appearances meet profile accessibility and contrast checks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/dev/immersive");
  await expect(page.getByRole("button", { name: "Next profile", exact: true })).toBeEnabled();
  for (const theme of ["dark", "light"]) {
    if (theme === "light") await page.getByRole("button", { name: "Switch to light mode" }).click();
    for (let index = 0; index < 4; index++) {
      const results = await new AxeBuilder({ page })
        .include('[aria-roledescription="post viewer"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      if (index < 3) await page.getByRole("button", { name: "Next profile", exact: true }).click();
    }
    for (let index = 0; index < 3; index++)
      await page.getByRole("button", { name: "Previous profile", exact: true }).click();
  }
});

test("empty media, next/previous, and end of feed stay navigable", async ({ page }) => {
  await page.goto("/dev/immersive");
  for (let index = 0; index < 5; index++)
    await page.getByRole("button", { name: "Next profile", exact: true }).click();
  await expect(page.getByText("No photos or video were added to this post.")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[5].title);
  await page.getByRole("button", { name: "Next profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Next profile", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Previous profile", exact: true }).click();
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[5].title);
});

test("failed browsing keeps the current profile and empty browsing offers recovery", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/feed/browse?**", (route) =>
    route.fulfill(
      failed ? { status: 503, json: {} } : { json: { refs: [], terminal: "exhausted" } }
    )
  );
  await page.goto("/dev/immersive");
  await page.getByRole("button", { name: "Business", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Posts could not load" })).toContainText(
    "Posts could not load"
  );
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[0].title);
  failed = false;
  await page.getByLabel("Show posts from").selectOption("Gauteng");
  await expect(page.getByText("Nothing here yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all of South Africa" })).toBeVisible();
});

test("browse loading, unavailable posts, and slide retries", async ({ page }) => {
  await page.route("**/api/feed/browse?**", (route) =>
    route.fulfill({ json: { refs: [encodeRef(slideRef(slides[1]))], terminal: "exhausted" } })
  );
  let failSlides = true;
  await page.route("**/api/feed/slides?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill(
      failSlides
        ? { status: 503, json: {} }
        : { json: { slides: [{ ref: encodeRef(slideRef(slides[1])), slide: slides[1] }] } }
    );
  });
  await page.goto("/dev/immersive");
  await page.getByRole("button", { name: "Business", exact: true }).click();
  // This fixture is already cached; switch to an uncached reference to exercise loading.
  await page.route("**/api/feed/browse?**", (route) =>
    route.fulfill({
      json: { refs: ["b.00000000-0000-4000-8000-000000000009"], terminal: "exhausted" },
    })
  );
  await page.getByRole("button", { name: "Business", exact: true }).click();
  await expect(page.getByText("This post could not be loaded.")).toBeVisible();
  failSlides = false;
  await page.unroute("**/api/feed/slides?**");
  await page.route("**/api/feed/slides?**", (route) =>
    route.fulfill({
      json: {
        slides: [
          {
            ref: "b.00000000-0000-4000-8000-000000000009",
            slide: {
              ...slides[1],
              id: "00000000-0000-4000-8000-000000000009",
              key: "businesses:00000000-0000-4000-8000-000000000009",
            },
          },
        ],
      },
    })
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(active(page).getByRole("heading", { level: 1 })).toHaveText(slides[1].title);
});
