import { randomInt } from "node:crypto";
import { expect, test, type BrowserContext, type Page, type Request } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { endedWithTest } from "./support/route-teardown";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  readTestSms,
} from "./support/test-copy";
import { registerConfirmedMember, syntheticIdNumber } from "./support/verified-member";

// The verification wizard's camera steps on the restored website in foundation
// mode, against the private test copy, with Chromium's fake camera device
// (ported from the retired stub suite's verification-flow.spec.ts):
//   - a new member without a verified phone is sent from /verification to the
//     phone step, enters the code from the copy's SMS sink, then opens
//     /verification again and starts at the ID step;
//   - ID step: the camera frame is scrolled into view with the capture control
//     focused, a photo is taken, and the captured photo is what the website
//     uploads when the member continues;
//   - selfie step: with the face-check runtime unavailable (a fake camera
//     cannot move like a person), the camera fills the screen, the face guide
//     sits exactly over the uncropped picture (object-fit contain) in portrait
//     and landscape, the close control stays reachable, the liveness button
//     stays disabled, and the manual-review photo is taken and uploaded;
//   - area step: province and city by hand (detection answers that it could
//     not detect them), then "Verification submitted", announced once.
//
// The ID, selfie and area steps are the same as in member-post-publish.spec.ts
// and staff-review.spec.ts, which use the upload fallback; this spec covers the
// camera itself. One new member per project run; their identity case stays
// waiting for review (staff specs find their own members by name).
//
// Network: browser requests may only reach the copy's website and its local
// database gateway; anything else is aborted and fails the test.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({
  serviceWorkers: "block",
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
  permissions: ["camera"],
});

type Reply = { path: string; status: number };

/** Lets only the copy's website and its gateway through and records the
 * status of the website's API replies (POST, PATCH, DELETE). */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  const replies: Reply[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== APP_ORIGIN && url.origin !== API_ORIGIN) {
      outside.push(url.origin);
      return route.abort("blockedbyclient");
    }
    if (
      url.origin !== APP_ORIGIN ||
      !url.pathname.startsWith("/api/") ||
      request.method() === "GET"
    )
      return route.continue();
    try {
      const response = await route.fetch({ maxRedirects: 0 });
      replies.push({ path: url.pathname, status: response.status() });
      return await route.fulfill({ response });
    } catch (error) {
      // The test already ended (its page closed mid-request); nothing to record.
      if (endedWithTest(error)) return;
      throw error;
    }
  });
  const reply = (pathname: string) =>
    replies.filter((entry) => entry.path === pathname).map((entry) => entry.status);
  return { outside, reply };
}

/** The multipart fields the website sent with an upload (text fields), and
 * the uploaded file's name and type. */
function uploadFields(request: Request) {
  const body = request.postDataBuffer()?.toString("latin1") ?? "";
  const fields: Record<string, string> = {};
  for (const part of body.split(/\r\n--/)) {
    const name = part.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    const file = part.match(/filename="([^"]*)"\r\nContent-Type: ([^\r]+)/);
    fields[name] = file ? `${file[1]} (${file[2]})` : (part.split("\r\n\r\n")[1] ?? "");
  }
  return fields;
}

/** The face guide covers exactly the visible camera picture: the video is
 * letterboxed (object-fit contain), never cropped. */
async function expectUncroppedSelfie(page: Page) {
  const guide = page.getByTestId("selfie-face-guide");
  await expect(guide).toBeVisible();
  const camera = await page.locator("video").evaluate((video: HTMLVideoElement) => {
    const rect = video.getBoundingClientRect();
    const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
    return {
      fit: getComputedStyle(video).objectFit,
      width: video.videoWidth * scale,
      height: video.videoHeight * scale,
      x: rect.x,
      y: rect.y,
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    };
  });
  expect(camera.fit).toBe("contain");
  const bounds = (await guide.boundingBox())!;
  expect(bounds.width).toBeCloseTo(camera.width, 0);
  expect(bounds.height).toBeCloseTo(camera.height, 0);
  expect(bounds.x).toBeCloseTo(camera.x + (camera.viewportWidth - camera.width) / 2, 0);
  expect(bounds.y).toBeCloseTo(camera.y + (camera.viewportHeight - camera.height) / 2, 0);
}

test.describe("verification wizard with the camera", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "The fake camera device is Chromium-only"
  );

  test("phone code, ID photo, selfie and area through the camera steps", async ({
    context,
    page,
  }) => {
    test.setTimeout(150_000);
    const member = await registerConfirmedMember("camera");
    const phone = `+2774${randomInt(1_000_000, 10_000_000)}`;
    const { outside, reply } = await guard(context);
    const session = await browserSessionCookies(readTestCopy(), member);
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));

    // ── Phone: /verification sends a member without a verified phone to the
    // phone step; the code comes from the copy's SMS sink. ──
    await page.goto("/verification");
    await page.waitForURL((url) => url.pathname === "/dashboard/complete-profile");
    expect(new URL(page.url()).searchParams.get("returnUrl")).toBe("/verification");
    await expect(page.getByRole("heading", { name: "Verify your phone number" })).toBeVisible();
    const smsBefore = readTestSms().length;
    await page.getByLabel("SA mobile number *").fill(phone.replace("+27", "0"));
    await page.getByRole("button", { name: "Send code" }).click();
    await expect.poll(() => readTestSms().length).toBe(smsBefore + 1);
    const sms = readTestSms().at(-1);
    expect(sms?.to).toBe(phone);
    const code = sms?.message.match(/code is: (\d{6})\./)?.[1];
    expect(code, "SMS code").toMatch(/^\d{6}$/);
    await page.getByLabel("6-digit code").fill(code as string);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page.getByText("This phone number is verified.")).toBeVisible();
    expect(reply("/api/otp/send")).toEqual([200]);
    expect(reply("/api/otp/verify")).toEqual([200]);
    // The page's "Continue" goes back through the client router, which still
    // holds the earlier prefetched redirect of /verification to this page; a
    // full load asks the server again, as a reload would.
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await page.goto("/verification");
    await expect(page).toHaveURL(`${APP_ORIGIN}/verification`);

    // ── Step 2: ID details + camera capture ──
    await expect(page.getByRole("heading", { name: /step 2: id details/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.locator("#firstName").fill(member.firstName);
    await page.locator("#lastName").fill(member.lastName);
    await page.locator("#idNumber").fill(syntheticIdNumber());
    await expect(page.getByText(/id number valid/i)).toBeVisible();

    await page.getByRole("button", { name: /open camera/i }).click();
    const video = page.locator("video");
    await expect(video).toBeVisible({ timeout: 20_000 });

    // The camera frame is scrolled into view and the capture control focused:
    // the member never has to scroll to find the frame. The scroll is smooth
    // (animated), so it is measured until it settles.
    await expect
      .poll(
        () =>
          video.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const viewportH = window.innerHeight || document.documentElement.clientHeight;
            const visiblePx = Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0);
            const active = document.activeElement;
            return {
              frameInView: rect.height > 0 && visiblePx / rect.height > 0.9,
              takePhotoFocused:
                active instanceof HTMLButtonElement && /take photo/i.test(active.textContent ?? ""),
            };
          }),
        { message: "camera frame (nearly) fully in the viewport, Take photo focused" }
      )
      .toEqual({ frameInView: true, takePhotoFocused: true });
    await expect(page.getByRole("button", { name: /take photo/i })).toBeInViewport();

    await page.getByRole("button", { name: /take photo/i }).click();
    await expect(page.getByRole("button", { name: /retake/i })).toBeVisible();
    await expect(page.getByRole("img", { name: "Captured photo" })).toBeVisible();
    await expect(video).toHaveCount(0);

    // The captured photo is what the website uploads for the ID.
    const idUpload = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/verification/upload"
    );
    await page.getByRole("button", { name: /^continue$/i }).click();
    expect(uploadFields(await idUpload)).toMatchObject({
      file: expect.stringMatching(/^capture-\d+\.jpg \(image\/jpeg\)$/),
      docType: "id_document",
      captureMethod: "camera",
    });

    // ── Step 3: Selfie camera capture ──
    await expect(page.getByRole("heading", { name: /step 3: selfie/i })).toBeVisible({
      timeout: 30_000,
    });
    expect(reply("/api/verification/upload")).toEqual([200]);

    // A fake camera cannot complete human movements. Exercise the explicit
    // unsupported-device path by blocking the self-hosted MediaPipe runtime.
    await page.route("**/vendor/mediapipe/**", (route) => route.abort());
    await page.getByRole("button", { name: /open camera/i }).click();
    await expect(page.locator("video")).toBeVisible({ timeout: 20_000 });
    const selfieDialog = page.getByRole("dialog", { name: "Selfie verification" });
    await expect(selfieDialog).toBeVisible();
    const bounds = await selfieDialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds?.x).toBe(0);
    expect(bounds?.y).toBe(0);
    expect(bounds?.width).toBe(viewport.width);
    expect(bounds?.height).toBe(viewport.height);
    expect(
      await selfieDialog.evaluate((el) => el.contains(document.elementFromPoint(24, 24)))
    ).toBe(true);
    await expectUncroppedSelfie(page);

    // Landscape phone: the picture stays on screen, uncropped, with its close control.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(async () => {
        const box = await page.locator("video").boundingBox();
        return box !== null && box.height > 100 && box.y + box.height <= 390;
      })
      .toBe(true);
    await expectUncroppedSelfie(page);
    await expect(page.getByRole("button", { name: "Close camera" })).toBeInViewport();
    await page.setViewportSize(viewport);

    await page.getByRole("button", { name: "Close camera" }).click();
    await expect(selfieDialog).not.toBeVisible();
    await page.getByRole("button", { name: /open camera/i }).click();
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByRole("button", { name: /complete liveness check/i })).toBeDisabled();
    await page.getByRole("button", { name: /use manual review/i }).click();
    await page.getByRole("button", { name: /take photo/i }).click();
    await expect(page.getByRole("button", { name: /retake/i })).toBeVisible();
    await expect(selfieDialog).not.toBeVisible();
    await expect(page.getByRole("img", { name: "Captured photo" })).toBeVisible();

    // The captured selfie is what the website uploads, never marked as a passed face check.
    const selfieUpload = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/verification/upload"
    );
    await page.getByRole("button", { name: /^continue$/i }).click();
    const selfieFields = uploadFields(await selfieUpload);
    expect(selfieFields).toMatchObject({
      file: expect.stringMatching(/^capture-\d+\.jpg \(image\/jpeg\)$/),
      docType: "selfie",
      captureMethod: "camera",
    });
    expect(selfieFields).not.toHaveProperty("livenessPassed");

    // ── Step 4: Province and city ──
    await expect(
      page.getByRole("heading", { name: /step 4: confirm your province and city/i })
    ).toBeVisible({ timeout: 30_000 });
    expect(reply("/api/verification/upload")).toEqual([200, 200]);

    await page.locator("#province").selectOption("Gauteng");
    await page.locator("#city").selectOption("Johannesburg");
    await page.getByRole("button", { name: /detect province and city/i }).click();
    await expect(page.getByText(/could not detect|detection is unavailable/i)).toBeVisible();
    await expect(page.locator("#province")).toHaveValue("Gauteng");
    await expect(page.locator("#city")).toHaveValue("Johannesburg");
    await expect(page.locator("#town")).toHaveCount(0);
    await page.getByRole("button", { name: /save location & finish/i }).click();

    // ── Done ──
    // Both the page header (h1) and the completion card (h2) use this title.
    await expect(
      page.getByRole("heading", { name: /Verification submitted/i, level: 2 })
    ).toBeVisible({ timeout: 30_000 });
    expect(reply("/api/verification/location/manual")).toEqual([200]);
    // The admin-review state is announced exactly once (the single gold banner).
    await expect(page.getByText("Verification pending admin review.")).toHaveCount(0);
    await expect(page.getByText(/your identity documents are in admin review/i)).toHaveCount(1);

    expect(
      queryTestCopy(
        "select count(*) from private.verification_identity_submissions " +
          `where owner_id = '${member.id}';`
      )
    ).toBe("1");
    expect(
      queryTestCopy(
        "select province_id || '/' || city_id from private.verification_localities " +
          `where owner_id = '${member.id}';`
      )
    ).toBe("gp/gp_johannesburg");
    expect(outside).toEqual([]);
  });
});
