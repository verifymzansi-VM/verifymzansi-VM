import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Authenticated end-to-end walkthrough of the account verification wizard:
 * phone OTP → ID details + camera capture → selfie camera capture →
 * location + GPS confirmation → submission complete.
 *
 * Runs only on Chromium with a fake camera device. Uses the Playwright stub
 * server (auth, database, storage, SMS all stubbed) plus the test-only
 * /api/e2e/verification fixture route to reset state and seed a known OTP.
 */

const PERSONA = "verify-flow";
const KNOWN_OTP = "123456";
const TEST_PHONE = "0712345678";
const VALID_SA_ID = "8001015009087"; // Luhn-valid, DOB 1980-01-01
const SCREENSHOT_DIR = path.join("test-results", "verification-flow");

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["camera", "geolocation"],
  geolocation: { latitude: -26.2041, longitude: 28.0473, accuracy: 25 },
});

test.describe("Verification wizard (authenticated)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Fake camera requires Chromium");

  test("full flow: OTP → ID camera → selfie camera → GPS location → submitted", async ({
    page,
  }) => {
    // ── Arrange: authenticated persona with a clean, unverified profile ──
    await page.goto(`/api/e2e/auth/session?persona=${PERSONA}&reset=1`, {
      waitUntil: "networkidle",
    });
    const resetRes = await page.request.post("/api/e2e/verification", {
      data: { action: "reset", persona: PERSONA },
    });
    expect(resetRes.ok()).toBeTruthy();

    // ── Step 1: Phone + OTP ─────────────────────────────────────────────
    await page.goto("/verification");
    await expect(page.getByRole("heading", { name: /step 1: phone \+ otp/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.locator("#phone").fill(TEST_PHONE);
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.locator("#otp")).toBeVisible({ timeout: 15_000 });

    // Replace the server-generated challenge with a known OTP.
    const seedRes = await page.request.post("/api/e2e/verification", {
      data: { action: "seed_otp", persona: PERSONA, phone: TEST_PHONE, otp: KNOWN_OTP },
    });
    expect(seedRes.ok()).toBeTruthy();

    await page.locator("#otp").fill(KNOWN_OTP);
    await page.getByRole("button", { name: /verify code/i }).click();

    // ── Step 2: ID details + camera capture ─────────────────────────────
    await expect(page.getByRole("heading", { name: /step 2: id details/i })).toBeVisible({
      timeout: 20_000,
    });

    await page.locator("#firstName").fill("Test");
    await page.locator("#lastName").fill("Member");
    await page.locator("#idNumber").fill(VALID_SA_ID);
    await expect(page.getByText(/id number valid/i)).toBeVisible();
    await shot(page, "step2-id-details");

    await page.getByRole("button", { name: /open camera/i }).click();
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 20_000 });

    // The camera frame must be scrolled into view and the capture control
    // focused — the user should never have to scroll to find the frame.
    // The scroll is smooth (animated), so let it settle before measuring.
    await page.waitForTimeout(800);
    const frameCheck = await video.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const visiblePx = Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0);
      const active = document.activeElement;
      return {
        visibleRatio: rect.height > 0 ? visiblePx / rect.height : 0,
        takePhotoFocused:
          active instanceof HTMLButtonElement && /take photo/i.test(active.textContent ?? ""),
      };
    });
    expect(
      frameCheck.visibleRatio,
      "camera frame should be (nearly) fully in the viewport"
    ).toBeGreaterThan(0.9);
    expect(frameCheck.takePhotoFocused, "Take Photo button should receive focus").toBe(true);
    await shot(page, "step2-camera-streaming");

    await page.getByRole("button", { name: /take photo/i }).click();
    await expect(page.getByRole("button", { name: /retake/i })).toBeVisible();
    await shot(page, "step2-id-captured");

    await page.getByRole("button", { name: /^continue$/i }).click();

    // ── Step 3: Selfie camera capture ───────────────────────────────────
    await expect(page.getByRole("heading", { name: /step 3: selfie/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /open camera/i }).click();
    await expect(page.locator("video")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /take photo/i }).click();
    await expect(page.getByRole("button", { name: /retake/i })).toBeVisible();
    await shot(page, "step3-selfie-captured");

    await page.getByRole("button", { name: /^continue$/i }).click();

    // ── Step 4: Location + GPS confirmation ─────────────────────────────
    await expect(page.getByRole("heading", { name: /step 4: verify your address/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.locator("#province").selectOption("Gauteng");
    await page.locator("#city").selectOption("Johannesburg");

    await page.getByRole("button", { name: /verify address with gps/i }).click();
    await expect(page.getByText(/address verified by gps/i)).toBeVisible({ timeout: 30_000 });

    // The review panel must reflect the GPS-verified address before saving —
    // it should never say "Not set" while a verified address is in the form.
    await expect(page.getByText(/gps verified — not saved yet/i)).toBeVisible();
    await shot(page, "step4-gps-verified");

    await page.getByRole("button", { name: /save address & finish/i }).click();

    // ── Done ────────────────────────────────────────────────────────────
    // Both the page header (h1) and the completion card (h2) use this title.
    await expect(
      page.getByRole("heading", { name: "Verification Submitted", level: 2 })
    ).toBeVisible({ timeout: 30_000 });

    // The admin-review state must be announced exactly once — the duplicate
    // amber banner was removed in favour of the single gold banner.
    await expect(page.getByText("Verification pending admin review.")).toHaveCount(0);
    await expect(page.getByText(/your verification is in admin review/i)).toHaveCount(1);
    await shot(page, "step5-submitted");
  });
});
