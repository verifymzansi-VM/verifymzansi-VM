import { expect, test } from "@playwright/test";

test.describe("Platform Smoke", () => {
  test("@smoke public pages render", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/VerifyMzansi/i);

    await page.goto("/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    await page.goto("/pricing");
    await expect(
      page
        .locator("main")
        .getByRole("heading", { name: /Starter|Growth|Pro/i })
        .first()
    ).toBeVisible();
  });

  test("@smoke protected pages redirect unauthenticated users", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await page.goto("/admin");
    await page.waitForURL(/\/login|\/banned|\/admin/);
  });

  test("@smoke API health responds 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const payload = (await response.json()) as { status?: string };
    expect(payload.status).toBeTruthy();
  });

  test("@smoke webhook endpoints handle malformed payloads without 5xx", async ({ request }) => {
    const payfast = await request.post("/api/webhooks/payfast", {
      form: {
        m_payment_id: "smoke-1",
        payment_status: "COMPLETE",
      },
    });
    expect(payfast.status()).toBeLessThan(500);

    const kyc = await request.post("/api/webhooks/kyc/provider", {
      data: {},
    });
    expect(kyc.status()).toBeLessThan(500);
  });

  test("@smoke mzansi business filters can be cleared from the keyboard", async ({ page }) => {
    await page.goto("/mzansi-business");

    const isMobileViewport = (page.viewportSize()?.width ?? 1280) < 1024;
    if (isMobileViewport) {
      await page.getByRole("button", { name: "Open business filters" }).click();
    }

    const search = isMobileViewport
      ? page.getByLabel("Search businesses")
      : page.getByLabel("Search");
    await expect(search).toBeVisible();

    await search.fill("coffee");
    await page.waitForTimeout(350);
    await expect(page).toHaveURL(/q=coffee/);

    if (isMobileViewport) {
      await page.getByRole("button", { name: "Clear all" }).click();
      await expect(search).toHaveValue("");
    } else {
      const clearQuery = page.getByRole("button", { name: /remove query filter coffee/i });
      await clearQuery.focus();
      await page.keyboard.press("Enter");
      await expect(search).toHaveValue("");
    }

    await expect(page).not.toHaveURL(/q=coffee/);
  });
});
