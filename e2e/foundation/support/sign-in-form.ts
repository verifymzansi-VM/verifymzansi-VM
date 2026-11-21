import { expect, type Locator, type Page } from "@playwright/test";

// Signing in through the restored login form against the copy's local Auth.
//
// The CAPTCHA: the site's test mode hands the form its bypass token, which the
// foundation sign-in route refuses by design (production Auth verifies real
// tokens). As in account-recovery.spec.ts, the tests swap that one token in the
// /api/auth/login request for a stand-in token; the copy's local Auth has no
// CAPTCHA secret and accepts it, as hosted Auth accepts a real widget token.

const LOGIN_PATH = "/api/auth/login";
const CAPTCHA_STAND_IN = "local-fixture-captcha-stand-in";

/** Waits until React has hydrated the element, so a click runs the page's
 * handler and not a plain form post. */
async function hydrated(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__react")))
    )
    .toBe(true);
}

/** Swaps the test-mode CAPTCHA token in sign-in requests and records the
 * statuses the website answered. */
export async function watchSignIn(page: Page) {
  const statuses: number[] = [];
  await page.route(`**${LOGIN_PATH}`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const body = JSON.parse(request.postData() ?? "{}");
    const response = await route.fetch({
      postData: JSON.stringify({ ...body, turnstileToken: CAPTCHA_STAND_IN }),
    });
    statuses.push(response.status());
    await route.fulfill({ response });
  });
  return statuses;
}

/** Fills and sends the sign-in form already open on the page, and waits for
 * the website's answer itself (a slow answer is reported as such). */
export async function submitSignInForm(page: Page, email: string, password: string) {
  const submit = page.getByRole("button", { name: /^Sign in$/ });
  await hydrated(submit);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === LOGIN_PATH && response.request().method() === "POST",
    { timeout: 45_000 }
  );
  await submit.click();
  await answered;
}
