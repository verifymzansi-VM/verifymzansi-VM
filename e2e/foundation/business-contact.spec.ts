import { expect, test, type BrowserContext, type Locator } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { enquiryCount, readTestCopy } from "./support/test-copy";

// Contacting a business on a phone takes no more taps than contacting a Market
// seller (roadmap M10.8). On the restored website a Market seller whose number
// is protected is reached in four taps: the card, the sticky "Contact seller"
// (which jumps to the contact card), "Send an enquiry", and the form's send
// button (the number path is also four: card, "Contact seller", "Show contact
// number", WhatsApp or Call). The test copy's seeded business offers only the
// enquiry form, the live default for business posts, which had no sticky bar
// at all: the form sat about two and a half screens down the page.
//
// Every tap is counted; scrolling is not a tap and never needed here. The
// CAPTCHA runs in the site's test mode (no visible widget), as in
// showroom-contact.spec.ts, so nothing leaves loopback.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const BUSINESS_TITLE = "Fixture Mzansi Motor Workshop";
/** Card, "Contact seller", "Send an enquiry", send: the Market seller's count. */
const MARKET_SELLER_TAPS_TO_SENT_MESSAGE = 4;

test.use({ serviceWorkers: "block", viewport: { width: 375, height: 812 }, hasTouch: true });

async function keepOnLoopback(context: BrowserContext) {
  const outside: string[] = [];
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    if (origin === APP_ORIGIN || origin === API_ORIGIN) return route.continue();
    outside.push(origin);
    return route.abort("blockedbyclient");
  });
  return outside;
}

test.describe("contacting a business on a phone", () => {
  test("a visitor goes from a business card to a sent enquiry in no more taps than for a Market seller", async ({
    context,
    page,
  }) => {
    const business = readTestCopy().posts.find((entry) => entry.title === BUSINESS_TITLE);
    if (!business) throw new Error(`The test copy has no post "${BUSINESS_TITLE}"`);
    const outside = await keepOnLoopback(context);
    let taps = 0;
    const tap = async (target: Locator) => {
      await target.tap();
      taps += 1;
    };

    await page.goto("/mzansi-business");
    await tap(
      page.locator(`a[href="/mzansi-business/${business.id}"]`).filter({ visible: true }).first()
    );
    await page.waitForURL(`${APP_ORIGIN}/mzansi-business/${business.id}`);

    // The sticky contact bar is on screen without scrolling. Its button comes
    // after the contact card's own "Send an enquiry" in the page.
    const bar = page
      .getByRole("button", { name: "Send an enquiry" })
      .filter({ visible: true })
      .last();
    await expect(bar).toBeInViewport();
    const saved = enquiryCount(business.id);
    await tap(bar);

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: `Enquire about ${BUSINESS_TITLE}` })
    ).toBeVisible();
    // A new reply address per run keeps reruns inside the database's flood limits.
    const reference = crypto.randomUUID().slice(0, 8);
    await dialog.getByLabel("Your name").fill("Thabo Visitor");
    await dialog.getByLabel("Reply email").fill(`visitor-${reference}@verifymzansi.test`);
    await dialog
      .getByLabel("Your message")
      .fill(`Do you service bakkies on Saturdays? Ref ${reference}`);
    await tap(dialog.getByRole("button", { name: "Send enquiry" }));
    await expect(dialog.getByText("Enquiry saved!")).toBeVisible();
    expect(enquiryCount(business.id)).toBe(saved + 1);

    expect(taps).toBeLessThanOrEqual(MARKET_SELLER_TAPS_TO_SENT_MESSAGE);
    expect(taps).toBe(3);
    expect(outside).toEqual([]);
  });

  test("closing the enquiry returns focus to the sticky bar's button", async ({
    context,
    page,
  }) => {
    const business = readTestCopy().posts.find((entry) => entry.title === BUSINESS_TITLE);
    if (!business) throw new Error(`The test copy has no post "${BUSINESS_TITLE}"`);
    const outside = await keepOnLoopback(context);
    await page.goto(`/mzansi-business/${business.id}`);
    const bar = page
      .getByRole("button", { name: "Send an enquiry" })
      .filter({ visible: true })
      .last();
    await expect(bar).toBeInViewport();
    await bar.tap();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(bar).toBeFocused();
    expect(outside).toEqual([]);
  });
});
