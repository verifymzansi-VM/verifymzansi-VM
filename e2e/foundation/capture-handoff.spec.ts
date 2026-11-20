import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { withSyntheticCamera } from "./support/synthetic-camera";
import { browserSessionCookies, queryTestCopy, readTestCopy } from "./support/test-copy";
import {
  registerUnreviewedMember,
  syntheticIdNumber,
  type VerifiedMember,
} from "./support/verified-member";

// "Continue on your phone" on the restored website against the private test
// copy (Didit plan, build step 2; owner decision: the phone must be signed in
// as the same account):
//   - a computer without a camera makes a link and shows its QR code;
//   - a second browser (the phone), signed in as the same member, opens the
//     link, takes the ID photo and the selfie with a synthetic camera, and the
//     computer moves on to the area step by itself;
//   - a phone signed in as another member is refused, and a signed-out phone is
//     asked to sign in first; neither uses up the link.
// The QR code's own token is never shown anywhere, so the test gives the
// member's newest link a known token directly in the local copy (owner SQL on
// the throwaway database, as the copy's other fixtures do).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

test.use({ serviceWorkers: "block" });

async function signedInContext(browser: Browser, member: VerifiedMember | null, phone: boolean) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    ...(phone
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          userAgent:
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
        }
      : {}),
  });
  if (member) {
    const session = await browserSessionCookies(readTestCopy(), member);
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
  }
  return context;
}

/** A computer without a camera: the browser answers "no camera found". */
async function withoutAnyCamera(context: BrowserContext) {
  await context.addInitScript({
    content: `Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => Promise.reject(new DOMException("none", "NotFoundError")) } });`,
  });
}

/** The computer: names and ID number typed, no camera, Continue on your phone. */
async function computerMakesLink(page: Page, member: VerifiedMember) {
  await page.goto("/verification");
  await expect(page.getByRole("heading", { name: /step 2: id details/i })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel("All first names (as on your ID)").fill(member.firstName);
  await page.getByLabel("Surname (as on your ID)").fill(member.lastName);
  await page.getByLabel("13-digit SA ID number").fill(syntheticIdNumber());
  await expect(page.getByText("ID number valid")).toBeVisible();
  await page.getByRole("button", { name: "Open camera" }).click();
  await page.getByRole("button", { name: "Continue on your phone" }).click();
  await expect(page.getByText("Waiting for your phone…")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Never send this code to anyone.")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
}

/** Gives the member's newest link a known token (local copy only). */
function knownToken(member: VerifiedMember) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const updated = queryTestCopy(
    `with newest as (select token_sha256 from private.capture_handoffs where owner_id='${member.id}'
       order by created_at desc limit 1)
     update private.capture_handoffs h set token_sha256='${hash}' from newest
       where h.token_sha256=newest.token_sha256 returning 1;`
  );
  expect(updated.trim()).toBe("1");
  return token;
}

test.describe("continue on your phone", () => {
  // The computer side needs a desktop browser (phones are not offered the link).
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || Boolean(isMobile),
    "Continue on your phone starts on a desktop computer, checked once in chromium."
  );

  test("the phone, signed in as the same member, sends both photos", async ({ browser }) => {
    test.setTimeout(180_000);
    const member = await registerUnreviewedMember("handoff");
    const computer = await signedInContext(browser, member, false);
    const phone = await signedInContext(browser, member, true);
    try {
      await withoutAnyCamera(computer);
      const computerPage = await computer.newPage();
      await computerMakesLink(computerPage, member);
      const token = knownToken(member);

      await withSyntheticCamera(phone);
      const phonePage = await phone.newPage();
      await phonePage.goto(`/verify/continue#${token}`);
      await expect(phonePage.getByText("Continuing your check from a computer.")).toBeVisible({
        timeout: 20_000,
      });
      // The token does not stay in the address bar.
      expect(new URL(phonePage.url()).hash).toBe("");

      // ID photo: open the camera, take it, check it and use it (sent at once).
      await phonePage.getByRole("button", { name: "Open camera" }).click();
      await expect(phonePage.locator("video")).toBeVisible({ timeout: 20_000 });
      await expect(async () => {
        await phonePage.getByRole("button", { name: "Take photo" }).click();
        await expect(phonePage.getByRole("button", { name: "Use this photo" })).toBeVisible({
          timeout: 2_000,
        });
      }).toPass({ timeout: 20_000 });
      await phonePage.getByRole("button", { name: "Use this photo" }).click();

      // Selfie: the face check cannot run on a synthetic camera; manual review.
      await expect(phonePage.getByRole("heading", { name: /selfie check/i })).toBeVisible({
        timeout: 30_000,
      });
      await phonePage.route("**/vendor/mediapipe/**", (route) => route.abort());
      await phonePage.getByRole("button", { name: "Open camera" }).click();
      await phonePage.getByRole("button", { name: /use manual review/i }).click();
      await phonePage.getByRole("button", { name: /take photo for manual review/i }).click();
      await expect(phonePage.getByText("All done")).toBeVisible({ timeout: 30_000 });

      // The computer moves on by itself.
      await expect(
        computerPage.getByRole("heading", { name: /step 4: confirm your province and city/i })
      ).toBeVisible({ timeout: 30_000 });
      expect(
        queryTestCopy(
          `select count(*) from private.frontend_verification_uploads where owner_id='${member.id}' and completed_at is not null;`
        ).trim()
      ).toBe("2");
    } finally {
      await computer.close();
      await phone.close();
    }
  });

  test("another member's phone is refused and a signed-out phone signs in first", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const member = await registerUnreviewedMember("handowner");
    const other = await registerUnreviewedMember("handother");
    const computer = await signedInContext(browser, member, false);
    const stranger = await signedInContext(browser, other, true);
    const signedOut = await signedInContext(browser, null, true);
    try {
      await withoutAnyCamera(computer);
      await computerMakesLink(await computer.newPage(), member);
      const token = knownToken(member);

      const strangerPage = await stranger.newPage();
      await strangerPage.goto(`/verify/continue#${token}`);
      await expect(strangerPage.getByText(/signed in to a different account/i)).toBeVisible({
        timeout: 20_000,
      });

      const signedOutPage = await signedOut.newPage();
      await signedOutPage.goto(`/verify/continue#${token}`);
      await expect(
        signedOutPage.getByText(
          "Sign in on your phone with the same account, then take the photos.",
          {
            exact: false,
          }
        )
      ).toBeVisible({ timeout: 20_000 });
      const signIn = signedOutPage.getByRole("link", { name: "Sign in" });
      await expect(signIn).toHaveAttribute("href", "/login?returnUrl=%2Fverify%2Fcontinue");
      // The token waits in this tab only, never in a URL.
      expect(await signIn.getAttribute("href")).not.toContain(token);

      // Neither phone used the link.
      expect(
        queryTestCopy(
          `select count(*) from private.capture_handoffs where owner_id='${member.id}' and used_at is not null;`
        ).trim()
      ).toBe("0");
    } finally {
      await computer.close();
      await stranger.close();
      await signedOut.close();
    }
  });
});
