import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { browserSessionCookies, readTestCopy } from "./support/test-copy";

// Page behaviour of the restored website's public forms and header in
// foundation mode, moved from the stub suite (PORTING.md): contact-form,
// posting-terms, home-discovery, header-session-shell, the validation and
// landing checks of auth-qa-audit and auth-recovery-readiness. Nothing here
// creates an account or saves a record: forms stop at their own validation,
// and the two recovery checks answer the website's auth routes in the browser.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

/** Waits until React has hydrated the element (it carries React's own
 * properties), so a click runs the page's handler and not a plain form post. */
async function hydrated(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__react")))
    )
    .toBe(true);
}

async function openForm(page: Page, path: string, submit: Locator) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await hydrated(submit);
}

function headerHtml(html: string): string {
  const start = html.indexOf("<header");
  return start >= 0 ? html.slice(start, html.indexOf("</header>", start)) : "";
}

async function serverHeader(page: Page): Promise<string> {
  const response = await page.request.get("/");
  expect(response.ok()).toBeTruthy();
  return headerHtml(await response.text());
}

test.describe("contact form", () => {
  test("the contact page shows its form and refuses an empty message", async ({ page }) => {
    const form = page.getByTestId("contact-form");
    const submit = form.locator("button[type='submit']");
    await openForm(page, "/contact", submit);
    await expect(form).toBeVisible();
    await submit.click();
    await expect(
      form.locator("[role='alert'], .text-red, .text-destructive, :invalid").first()
    ).toBeVisible();
  });
});

test.describe("posting terms", () => {
  test("former per-version Terms addresses lead to the one set of Terms", async ({ page }) => {
    for (const path of ["/terms/versions/posting-v1", "/terms/versions/posting-v4"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe("/terms");
    }
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Slots & prices/ })).toBeVisible();
    await expect(page.getByText(/billing@verifymzansi\.com/)).toBeVisible();
  });
});

test.describe("header", () => {
  test("the mobile menu keeps scrolling, returns focus and resets on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("mobile-menu-toggle");
    await hydrated(toggle);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByText("Sign in", { exact: true })
      .focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });

  test("the server renders the signed-out header for a visitor", async ({ page }) => {
    expect(await serverHeader(page)).toContain("Sign in");
  });

  test("the server renders the signed-in header on the first paint for a member", async ({
    context,
    page,
  }) => {
    // A real local sign-in of the seeded verified member; nothing is changed.
    const session = await browserSessionCookies(readTestCopy(), "verifiedMember");
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    const header = await serverHeader(page);
    expect(header).not.toContain("Sign in");
    expect(header).toContain('aria-label="Account menu"');
  });
});

test.describe("sign-in and registration forms", () => {
  test("an empty registration shows every field's error", async ({ page }) => {
    const submit = page.getByRole("button", { name: /create account/i });
    await openForm(page, "/register", submit);
    await submit.click();
    await expect(
      page.getByRole("alert").filter({ hasText: /^Name must be at least 2 characters$/ })
    ).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: /^Surname must be at least 2 characters$/ })
    ).toBeVisible();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Phone number is required")).toBeVisible();
    await expect(page.getByText("Password must be at least 12 characters")).toBeVisible();
    await expect(page.getByText("You must accept the terms of service")).toBeVisible();
  });

  for (const check of [
    {
      name: "passwords that do not match",
      phone: "0712345678",
      confirm: "TestPass5678",
      error: "Passwords do not match",
    },
    {
      name: "a phone number that is not South African",
      phone: "1234567890",
      confirm: "TestPass1234",
      error: "Enter a valid SA mobile number",
    },
  ]) {
    test(`registration refuses ${check.name}`, async ({ page }) => {
      let registerCalls = 0;
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/auth/register") registerCalls += 1;
      });
      const submit = page.getByRole("button", { name: /create account/i });
      await openForm(page, "/register", submit);
      await page.fill("#firstName", "QA");
      await page.fill("#lastName", "Check");
      await page.fill("#email", `qa-${crypto.randomUUID().slice(0, 8)}@example.com`);
      await page.fill("#phone", check.phone);
      await page.fill("#password", "TestPass1234");
      await page.fill("#confirmPassword", check.confirm);
      await page.check("#acceptTerms");
      await submit.click();
      await expect(page.getByText(check.error)).toBeVisible();
      // Refused in the browser: nothing reached the registration route.
      expect(registerCalls).toBe(0);
    });
  }

  test("an empty sign-in shows its errors without calling the server", async ({ page }) => {
    let loginCalls = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/auth/login" && request.method() === "POST")
        loginCalls += 1;
    });
    const submit = page.getByRole("button", { name: /sign in/i });
    await openForm(page, "/login", submit);
    await submit.click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
    expect(loginCalls).toBe(0);
  });

  test("after registering, the sign-in page asks the person to check their email", async ({
    page,
  }) => {
    await page.goto("/login?registered=true", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Check your email", { exact: true })).toBeVisible();
    await expect(page.getByText(/We've sent a confirmation link/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /resend confirmation/i })).toBeVisible();
  });
});

test.describe("sign-in and recovery outages (answered in the browser)", () => {
  test("the confirmation destination survives a failed sign-in and a successful retry", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route("**/api/auth/login", async (route) => {
      attempts += 1;
      if (attempts === 1) return route.abort("failed");
      await route.fulfill({ status: 200, json: { success: true } });
    });
    await page.goto("/login?confirmed=true&returnUrl=%2Fmzansi-market");
    await expect(page.getByText("Email confirmed!", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmzansi-market$/);
    const submit = page.getByRole("button", { name: /^Sign in$/ });
    await hydrated(submit);
    await page.getByLabel("Email", { exact: true }).fill("recovery@example.com");
    await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
    await submit.click();
    await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("recovery@example.com");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("StrongPass123!");
    await submit.click();
    await expect(page).toHaveURL(/\/mzansi-market$/);
    expect(attempts).toBe(2);
  });

  test("password recovery retries an outage, keeps the input and recognises an expired session", async ({
    page,
  }) => {
    // Auth pages reload once to clear stale service-worker caches, and some
    // engines start the link check before that reload. Keep the outage up until
    // Retry is pressed so the discarded first load cannot consume it.
    let outage = true;
    let checksAfterOutage = 0;
    let submissions = 0;
    await page.route("**/api/auth/reset-password", async (route) => {
      if (route.request().method() === "GET") {
        if (outage) {
          await route.fulfill({ status: 503, json: { valid: false } });
          return;
        }
        checksAfterOutage += 1;
        await route.fulfill({ status: 200, json: { valid: true } });
        return;
      }
      submissions += 1;
      if (submissions === 1) return route.abort("failed");
      await route.fulfill({ status: 401, json: { error: "Recovery session expired" } });
    });
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Couldn't check your link" })).toBeVisible();
    outage = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.getByLabel("New password", { exact: true }).fill("StrongPass123!");
    await page.getByLabel("Confirm password", { exact: true }).fill("StrongPass123!");
    await page.getByRole("button", { name: "Save password", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "We couldn't save your new password" })
    ).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toHaveValue("StrongPass123!");
    await page.getByRole("button", { name: "Save password", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password"
    );
    expect(checksAfterOutage).toBe(1);
    expect(submissions).toBe(2);
  });
});
