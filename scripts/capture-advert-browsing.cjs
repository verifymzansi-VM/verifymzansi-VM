const fs = require("node:fs/promises");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  await fs.mkdir("public/video/advert-browsing", { recursive: true });
  const manifest = {};
  for (const [name, path] of [
    ["market", "/mzansi-market"],
    ["business", "/mzansi-business"],
    ["tourism", "/tourism-events"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 540, height: 960 },
      recordVideo: { dir: "output/advert-capture", size: { width: 540, height: 960 } },
      reducedMotion: "reduce",
    });
    const captureStart = Date.now();
    const page = await context.newPage();
    await page.goto("https://verifymzansi.com" + path, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1800);
    const title = await page.title();
    if ((await page.locator("body").innerText()).match(/404|page could not be found/i))
      throw new Error("Invalid capture route: " + path);
    const play = page.getByRole("button", { name: "Play video", exact: true }).first();
    if (await play.isVisible()) await play.click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("video")).some(
          (video) => !video.paused && video.currentTime > 0.2
        ),
      undefined,
      { timeout: 15000 }
    );
    await page.screenshot({ path: "output/advert-capture/" + name + "-screen.png" });
    manifest[name] = {
      trimBefore: Math.round(((Date.now() - captureStart) * 30) / 1000),
      url: page.url(),
    };
    await page.waitForTimeout(3300);
    const playback = await page
      .locator("video")
      .evaluateAll((videos) =>
        videos
          .map((video) => ({ playing: !video.paused, time: video.currentTime }))
          .filter((video) => video.playing)
      );
    const video = page.video();
    await context.close();
    await video.saveAs("public/video/advert-browsing/" + name + "-motion.webm");
    console.log(name + ": " + title + " — active video playback: " + JSON.stringify(playback));
  }
  await fs.writeFile("remotion/compositions/advert-motion.json", JSON.stringify(manifest, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
