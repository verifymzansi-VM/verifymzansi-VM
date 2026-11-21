import { expect, test, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";

// The test-only WebKit camera (e2e/support/webkit-fake-camera.ts) in the
// mobile-safari project: a page gets a live, non-black, changing camera
// picture from getUserMedia, also when it attaches the stream to a <video> a
// moment later (as the verification page does after fetching a capture
// token), and a spec's own canvas camera stream plays the same way. Chromium
// projects use their fake device flags instead, so this runs in WebKit only.
//
// The page is a blank document on the copy's origin (a secure context), served
// by the test itself; nothing reaches the website or the database.

const BLANK = `http://127.0.0.1:${E2E_FIXTURE.appPort}/__webkit-fake-camera-check`;

async function openBlankPage(page: Page) {
  await page.route(BLANK, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>camera</title><body></body>",
    })
  );
  await page.goto(BLANK);
}

/** Attaches a stream to a new <video> after `delayMs`, then reads two frames
 * from it through a canvas, the way the website's capture code does. */
async function attachLateAndRead(page: Page, source: "camera" | "own-canvas", delayMs: number) {
  return page.evaluate(
    async ({ source, delayMs }) => {
      let stream: MediaStream;
      if (source === "camera") {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = 1600;
        canvas.height = 1000;
        const ctx = canvas.getContext("2d")!;
        const paint = () => {
          const image = ctx.createImageData(canvas.width, canvas.height);
          for (let i = 0; i < image.data.length; i += 4) {
            const v = 60 + Math.floor(Math.random() * 140);
            image.data.set([v, v, v, 255], i);
          }
          ctx.putImageData(image, 0, 0);
        };
        paint();
        setInterval(paint, 100);
        stream = canvas.captureStream(5);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      document.body.appendChild(video);
      const metadata = new Promise<boolean>((resolve) => {
        video.addEventListener("loadedmetadata", () => resolve(true), { once: true });
        setTimeout(() => resolve(false), 5_000);
      });
      video.srcObject = stream;
      const played = await Promise.race([
        video.play().then(
          () => "played",
          (error: Error) => `rejected: ${error.name}`
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("never settled"), 5_000)),
      ]);
      const sawMetadata = await metadata;
      const read = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        let blown = 0;
        for (let i = 0; i < data.length; i += 4) {
          const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += luma;
          if (luma >= 250) blown += 1;
        }
        return {
          pixels: Array.from(data),
          brightness: sum / (data.length / 4),
          glare: blown / (data.length / 4),
        };
      };
      const first = read();
      await new Promise((resolve) => setTimeout(resolve, 400));
      const second = read();
      let changed = 0;
      for (let i = 0; i < first.pixels.length; i += 4)
        if (Math.abs(first.pixels[i] - second.pixels[i]) > 8) changed += 1;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const result = {
        played,
        sawMetadata,
        readyState: video.readyState,
        width: video.videoWidth,
        height: video.videoHeight,
        paused: video.paused,
        srcObjectKept: video.srcObject === stream,
        brightness: Math.round(first.brightness),
        glare: first.glare,
        changedShare: changed / (first.pixels.length / 4),
        cameras: devices.filter((device) => device.kind === "videoinput").length,
        trackEnded: false,
      };
      stream.getTracks().forEach((track) => track.stop());
      result.trackEnded = stream.getVideoTracks().every((track) => track.readyState === "ended");
      video.srcObject = null;
      return result;
    },
    { source, delayMs }
  );
}

test.describe("WebKit fake camera", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "webkit", "The WebKit fake camera is checked in mobile-safari only.");
  });

  test("getUserMedia gives a live test card, also to a video attached late", async ({ page }) => {
    await openBlankPage(page);
    const camera = await attachLateAndRead(page, "camera", 1_500);
    expect(camera).toMatchObject({
      played: "played",
      sawMetadata: true,
      readyState: 4,
      width: 1920,
      height: 1080,
      paused: false,
      srcObjectKept: true,
      trackEnded: true,
    });
    expect(camera.cameras).toBeGreaterThanOrEqual(1);
    // Not black, not washed out, and moving (the website's quality hints:
    // dark below 60, glare above 4% near-white pixels).
    expect(camera.brightness).toBeGreaterThan(60);
    expect(camera.brightness).toBeLessThan(220);
    expect(camera.glare).toBeLessThan(0.04);
    expect(camera.changedShare).toBeGreaterThan(0.01);
  });

  test("a spec's own canvas camera stream plays the same way", async ({ page }) => {
    await openBlankPage(page);
    const own = await attachLateAndRead(page, "own-canvas", 1_500);
    expect(own).toMatchObject({
      played: "played",
      sawMetadata: true,
      readyState: 4,
      width: 1600,
      height: 1000,
      srcObjectKept: true,
    });
    expect(own.brightness).toBeGreaterThan(60);
    expect(own.changedShare).toBeGreaterThan(0.01);
  });
});
