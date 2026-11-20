import { expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * A synthetic camera for the verification photo steps: the page's own
 * getUserMedia gets a canvas stream of random noise (never a face or a
 * document, and different on every run, since the risk check rejects reused
 * photos). Photos are taken only with the camera on the page, so specs that
 * are not about the camera itself take their photos through this one. It works
 * in every test browser, unlike Chromium's fake device flags; it is what the
 * plan calls a "virtual camera", which a server cannot tell apart from a real
 * one (staff review covers that).
 */
export async function withSyntheticCamera(
  context: BrowserContext,
  { width = 1600, height = 1000 } = {}
) {
  await context.addInitScript(
    ({ width, height }) => {
      const open = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d")!;
        const paint = () => {
          const image = ctx.createImageData(width, height);
          for (let i = 0; i < image.data.length; i += 4) {
            const v = 60 + Math.floor(Math.random() * 140);
            image.data[i] = v;
            image.data[i + 1] = v;
            image.data[i + 2] = v;
            image.data[i + 3] = 255;
          }
          ctx.putImageData(image, 0, 0);
        };
        paint();
        const stream = canvas.captureStream(5);
        const timer = window.setInterval(paint, 200);
        for (const track of stream.getTracks())
          track.addEventListener("ended", () => window.clearInterval(timer));
        return stream;
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: open, enumerateDevices: async () => [] },
      });
    },
    { width, height }
  );
}

/** The ID step's camera: open, take the photo, check it and use it. */
export async function takeIdPhoto(page: Page) {
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(page.locator("video")).toBeVisible({ timeout: 20_000 });
  const shutter = page.getByRole("button", { name: "Take photo" });
  await expect(async () => {
    await shutter.click();
    await expect(page.getByRole("button", { name: "Use this photo" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("img", { name: "Captured photo" })).toBeVisible();
}

/**
 * The selfie step's camera with the face check unavailable (a synthetic camera
 * cannot move like a person; the self-hosted face model is blocked), so the
 * member takes the photo for manual review, as on a device where the check
 * cannot run.
 */
export async function takeSelfieForManualReview(page: Page) {
  await page.route("**/vendor/mediapipe/**", (route) => route.abort());
  await page.getByRole("button", { name: "Open camera" }).click();
  await expect(page.locator("video")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /use manual review/i }).click();
  await page.getByRole("button", { name: /take photo for manual review/i }).click();
  await expect(page.getByRole("img", { name: "Captured photo" })).toBeVisible({
    timeout: 20_000,
  });
}
