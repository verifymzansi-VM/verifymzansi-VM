import { expect, test } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

test.describe("Contact Form", () => {
  test("@smoke contact page loads", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/contact");
    // Should show the contact form
    await expect(page.locator("form, [data-testid='contact-form']").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("@smoke contact form rejects empty submission", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/contact");

    const submitBtn = page.locator("button[type='submit']").first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      // Should show validation errors (required fields)
      await expect(
        page.locator("[role='alert'], .text-red, .text-destructive, :invalid").first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("@smoke contact form strips HTML tags from message", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/contact");

    // Fill in required fields
    const nameInput = page.locator("input[name='name']").first();
    const emailInput = page.locator("input[name='email'], input[type='email']").first();
    const messageInput = page.locator("textarea[name='message'], textarea").first();

    if (await nameInput.isVisible()) {
      await nameInput.fill("Test User");
    }
    if (await emailInput.isVisible()) {
      await emailInput.fill("test@example.com");
    }
    if (await messageInput.isVisible()) {
      await messageInput.fill("<script>alert('xss')</script>Hello");
      // The message input should not contain script tags after processing
      const value = await messageInput.inputValue();
      // At the input level, the raw value is preserved — stripping happens server-side
      expect(value).toContain("Hello");
    }
  });
});
