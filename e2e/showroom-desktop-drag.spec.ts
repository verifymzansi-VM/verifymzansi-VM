import { expect, test } from "@playwright/test";

test.describe("Marketplace showroom desktop drag", () => {
  test("dragging a showroom card with the mouse rotates the carousel without navigating", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop drag coverage runs in Chromium only.");

    const routePath = "/dev/showroom-drag";

    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const showroomSection = page.locator("section[aria-roledescription='carousel']").first();
    await expect(showroomSection).toBeVisible();

    const liveRegion = showroomSection.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toContainText("Slide 1 of");

    const ambientVideo = showroomSection.locator("video").first();
    await expect(ambientVideo).toHaveAttribute("src", /advertiser-desktop\.webm$/);

    const activeCardLink = showroomSection.getByRole("link", { name: /^Open / }).first();
    await expect(activeCardLink).toBeVisible();

    const box = await activeCardLink.boundingBox();
    expect(box).not.toBeNull();

    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 160, startY, { steps: 10 });
    await page.mouse.up();

    await expect(liveRegion).toContainText("Slide 2 of");
    expect(new URL(page.url()).pathname).toBe(routePath);
  });
});
