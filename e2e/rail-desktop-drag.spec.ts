import { expect, test } from "@playwright/test";

test.describe("Homepage showcase rail desktop drag", () => {
  test("dragging a rail card with the mouse scrolls before release and does not navigate", async ({
    page,
  }) => {
    const routePath = "/dev/rail-drag";

    await page.goto(routePath, { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle").catch(() => {});

    const rail = page.getByLabel("Rail drag showcase");
    await expect(rail).toBeVisible();

    const activeCardLink = rail.getByRole("link", { name: /rail test one/i }).first();
    await expect(activeCardLink).toBeVisible();

    await rail.evaluate((node) => {
      node.scrollLeft = 0;
    });
    expect(await rail.evaluate((node) => node.scrollLeft)).toBe(0);

    const box = await activeCardLink.boundingBox();
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
