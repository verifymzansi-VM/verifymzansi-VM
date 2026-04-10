import { expect, test } from "@playwright/test";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

test.describe("Promotions showroom", () => {
  test("renders the showroom and keeps events tab usable", async ({ page }) => {
    await page.context().addCookies([
      {
        name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
        value: "1",
        url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
      },
    ]);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    page.on("pageerror", (error) => {
      pageErrors.push(String(error));
    });

    await page.goto("/promotions", { waitUntil: "domcontentloaded" });
    await page.locator("body").waitFor({ state: "visible" });
    await page.getByRole("heading", { level: 1, name: "Tourism & Events" }).waitFor({
      state: "visible",
    });
    await page.waitForLoadState("networkidle").catch(() => {});

    const showroomSection = page.locator("section").first();
    await expect(showroomSection).toBeVisible();
    await expect(
      showroomSection.getByRole("link", { name: /view business|view event|create event/i }).first()
    ).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "Tourism & Events sections" });
    await expect(tablist).toBeVisible();

    const tourismTab = tablist.getByRole("tab", { name: "Tourism" });
    const eventsTab = tablist.getByRole("tab", { name: "Events" });
    await expect(tourismTab).toHaveAttribute("aria-selected", "true");
    await expect(eventsTab).toHaveAttribute("aria-selected", "false");

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await eventsTab.click();
      const isSelected = await eventsTab.getAttribute("aria-selected");
      if (isSelected === "true") {
        break;
      }

      if (attempt === 3) {
        await expect(eventsTab).toHaveAttribute("aria-selected", "true");
      }
    }

    await expect(page.getByRole("link", { name: /create event/i }).first()).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/event|loading events/i);

    expect(
      consoleErrors.filter((message) => /hydration|runtime|typeerror|referenceerror/i.test(message))
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
