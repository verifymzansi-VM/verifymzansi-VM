import { expect, test, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { submitSignInForm, watchSignIn } from "./support/sign-in-form";
import { registerUnreviewedMember, type VerifiedMember } from "./support/verified-member";

// Sign-in through the restored login form against the real website routes and
// the copy's local Auth (foundation mode): a wrong password, the return to the
// page a visitor asked for, an unsafe return address, and a signed-in member
// sent away from the sign-in and sign-up pages. Moved from the stub suite's
// auth-qa-audit TC04, TC05, TC11 and TC12, which ran on an in-memory stub. The
// empty-form, protected-page and "registered" checks are in public-forms.spec.ts
// and public-pages.spec.ts.
//
// The CAPTCHA stand-in token: see support/sign-in-form.ts.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

// The site registers its service worker in the browser tests too. Playwright's
// page.route can miss requests from a page that worker controls (WebKit routes
// them past the page), so specs that answer requests in the browser block it,
// as Playwright recommends for request interception.
test.use({ serviceWorkers: "block" });

test.describe.configure({ mode: "serial" });

let member: VerifiedMember;
test.beforeAll(async () => {
  test.setTimeout(90_000);
  // Legal name saved and phone verified, so member pages open without the
  // complete-profile step.
  member = await registerUnreviewedMember("signin");
});

async function signInThroughForm(
  page: Page,
  path: string,
  password = member.password,
  email = member.email
) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await submitSignInForm(page, email, password);
}

test("a wrong password and an unknown address get the same refusal and stay signed out", async ({
  page,
}) => {
  const statuses = await watchSignIn(page);
  // The foundation route's wording (src/lib/foundation/password-auth.ts); it
  // says nothing about whether the account exists.
  const refusal = page.getByText("Unable to sign in with these details", { exact: true }).first();
  await signInThroughForm(page, "/login", `${member.password}-wrong`);
  await expect(refusal).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    `${member.password}-wrong`
  );
  expect(new URL(page.url()).pathname).toBe("/login");
  await signInThroughForm(
    page,
    "/login",
    member.password,
    `nobody-${member.id.slice(0, 8)}@verifymzansi.test`
  );
  await expect(refusal).toBeVisible();
  expect(statuses).toEqual([401, 401]);
  // Still signed out: a member page sends the visitor to sign in.
  await page.goto("/dashboard");
  await page.waitForURL((url) => url.pathname === "/login");
});

test("signing in returns the member to the page they asked for", async ({ page }) => {
  const statuses = await watchSignIn(page);
  // A visitor opening a member page is sent to sign in with a return address.
  await page.goto("/dashboard");
  await page.waitForURL((url) => url.pathname === "/login");
  expect(new URL(page.url()).searchParams.get("returnUrl")).toBe("/dashboard");
  await signInThroughForm(page, page.url());
  await page.waitForURL(`${APP_ORIGIN}/dashboard`);
  expect(statuses).toEqual([200]);
});

test("an outside return address is ignored and the member lands on the home page", async ({
  page,
}) => {
  const statuses = await watchSignIn(page);
  await signInThroughForm(page, "/login?returnUrl=%2F%2Fexample.com%2Fsteal");
  await page.waitForURL(`${APP_ORIGIN}/`);
  expect(statuses).toEqual([200]);
});

test("a signed-in member is sent away from the sign-in and sign-up pages", async ({ page }) => {
  await watchSignIn(page);
  await signInThroughForm(page, "/login");
  await page.waitForURL(`${APP_ORIGIN}/`);
  // Foundation sends a signed-in member with a verified phone to the
  // dashboard (src/lib/foundation/page-access.ts).
  for (const path of ["/login", "/register"]) {
    await page.goto(path);
    await page.waitForURL(`${APP_ORIGIN}/dashboard`);
    expect(new URL(page.url()).pathname, path).toBe("/dashboard");
  }
});
