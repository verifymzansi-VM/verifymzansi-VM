import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";

const baseUrl =
  process.env.CAPTURE_BASE_URL ||
  process.env.PUBLIC_VERIFY_BASE_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://verifymzansi.com";

const dateStamp = new Date().toISOString().slice(0, 10);
const outputRoot =
  process.env.CAPTURE_OUTPUT_DIR ||
  path.join(process.cwd(), "output", "playwright", `live-site-${dateStamp}`);
const latestPointer = path.join(process.cwd(), "output", "playwright", "latest-live-site.txt");

type PublicTarget = {
  slug: string;
  pagePath: string;
  fullPage?: boolean;
};

const targets: PublicTarget[] = [
  { slug: "home", pagePath: "/" },
  { slug: "mzansi-market", pagePath: "/mzansi-market" },
  { slug: "mzansi-business", pagePath: "/mzansi-business" },
  { slug: "promotions", pagePath: "/promotions" },
  { slug: "promotions-events", pagePath: "/promotions/events" },
  { slug: "advertise", pagePath: "/advertise", fullPage: true },
  { slug: "pricing", pagePath: "/pricing", fullPage: true },
  { slug: "verify-buyer", pagePath: "/verify-buyer", fullPage: true },
  { slug: "contact", pagePath: "/contact", fullPage: true },
  { slug: "privacy", pagePath: "/privacy", fullPage: true },
  { slug: "terms", pagePath: "/terms", fullPage: true },
  { slug: "safety-scam-alerts", pagePath: "/safety/scam-alerts", fullPage: true },
  {
    slug: "safety-meeting-checklist",
    pagePath: "/safety/meeting-checklist",
    fullPage: true,
  },
  { slug: "login", pagePath: "/login" },
  { slug: "register", pagePath: "/register", fullPage: true },
];

type CaptureContext = {
  name: "desktop" | "mobile";
  browser: Browser;
  context: BrowserContext;
  page: Page;
  viewportLabel: string;
  logsDir: string;
  shotsDir: string;
};

function urlFor(pagePath: string) {
  return new URL(pagePath, baseUrl).toString();
}

async function prepareOutput() {
  await rm(outputRoot, { recursive: true, force: true });

  await Promise.all([
    mkdir(path.join(outputRoot, "desktop"), { recursive: true }),
    mkdir(path.join(outputRoot, "mobile"), { recursive: true }),
    mkdir(path.join(outputRoot, "logs", "desktop"), { recursive: true }),
    mkdir(path.join(outputRoot, "logs", "mobile"), { recursive: true }),
    mkdir(path.join(outputRoot, "social"), { recursive: true }),
    mkdir(path.join(outputRoot, "manifest"), { recursive: true }),
    mkdir(path.join(outputRoot, "journeys", "raw"), { recursive: true }),
    mkdir(path.join(outputRoot, "journeys"), { recursive: true }),
  ]);
}

async function createDesktopCapture(browser: Browser): Promise<CaptureContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  return {
    name: "desktop",
    browser,
    context,
    page,
    viewportLabel: "1440x1200",
    shotsDir: path.join(outputRoot, "desktop"),
    logsDir: path.join(outputRoot, "logs", "desktop"),
  };
}

async function createMobileCapture(browser: Browser): Promise<CaptureContext> {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    colorScheme: "light",
  });
  const page = await context.newPage();
  return {
    name: "mobile",
    browser,
    context,
    page,
    viewportLabel: "Pixel 7",
    shotsDir: path.join(outputRoot, "mobile"),
    logsDir: path.join(outputRoot, "logs", "mobile"),
  };
}

async function captureTarget(capture: CaptureContext, target: PublicTarget) {
  const consoleMessages: string[] = [];
  const failedRequests: string[] = [];

  const handleConsole = (msg: { type(): string; text(): string }) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  };
  const handleRequestFailed = (request: {
    method(): string;
    url(): string;
    failure(): { errorText?: string } | null;
  }) => {
    failedRequests.push(
      `[requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`
    );
  };

  capture.page.on("console", handleConsole);
  capture.page.on("requestfailed", handleRequestFailed);

  try {
    await capture.page.goto(urlFor(target.pagePath), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await capture.page.waitForTimeout(2_500);

    const viewportPath = path.join(capture.shotsDir, `${target.slug}-viewport.png`);
    await capture.page.screenshot({ path: viewportPath, type: "png" });

    if (target.fullPage) {
      await capture.page.screenshot({
        path: path.join(capture.shotsDir, `${target.slug}-full.png`),
        type: "png",
        fullPage: true,
      });
    }

    const logLines = [
      `URL: ${capture.page.url()}`,
      `Viewport: ${capture.viewportLabel}`,
      consoleMessages.length ? "" : "No console entries captured.",
      ...consoleMessages,
      failedRequests.length ? "" : "No failed requests captured.",
      ...failedRequests,
    ];

    await writeFile(path.join(capture.logsDir, `${target.slug}.log`), logLines.join("\n"), "utf8");
    process.stdout.write(`[capture:${capture.name}] ${target.slug}\n`);
  } finally {
    capture.page.off("console", handleConsole);
    capture.page.off("requestfailed", handleRequestFailed);
  }
}

async function captureSocialScreens(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 2048, height: 1152 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const shots: Array<{ pagePath: string; filename: string }> = [
    { pagePath: "/", filename: "home-banner.png" },
    { pagePath: "/pricing", filename: "pricing-banner.png" },
    { pagePath: "/advertise", filename: "advertise-banner.png" },
  ];

  for (const shot of shots) {
    await page.goto(urlFor(shot.pagePath), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({
      path: path.join(outputRoot, "social", shot.filename),
      type: "png",
    });
    process.stdout.write(`[capture:social] ${shot.filename}\n`);
  }

  await context.close();
}

async function captureManifestScreens(browser: Browser) {
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: "light",
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(urlFor("/"), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await desktopPage.waitForTimeout(2_000);
  await desktopPage.screenshot({
    path: path.join(outputRoot, "manifest", "home-wide.png"),
    type: "png",
  });
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(urlFor("/"), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await mobilePage.waitForTimeout(2_000);
  await mobilePage.screenshot({
    path: path.join(outputRoot, "manifest", "home-narrow.png"),
    type: "png",
  });
  await mobileContext.close();
}

async function recordJourney(
  browser: Browser,
  opts: {
    name: string;
    mobile?: boolean;
    viewport: { width: number; height: number };
  }
) {
  const context = await browser.newContext({
    ...(opts.mobile ? devices["Pixel 7"] : {}),
    viewport: opts.viewport,
    colorScheme: "light",
    recordVideo: {
      dir: path.join(outputRoot, "journeys", "raw"),
      size: opts.viewport,
    },
  });

  const page = await context.newPage();
  const video = page.video();
  const steps = [
    { pagePath: "/", scrollY: 0 },
    { pagePath: "/advertise", scrollY: 420 },
    { pagePath: "/pricing", scrollY: 240 },
    { pagePath: "/register", scrollY: 0 },
  ];

  for (const step of steps) {
    await page.goto(urlFor(step.pagePath), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1_800);
    if (step.scrollY > 0) {
      await page.evaluate(
        (scrollY) => window.scrollTo({ top: scrollY, behavior: "instant" }),
        step.scrollY
      );
      await page.waitForTimeout(900);
    }
  }

  await context.close();

  if (!video) {
    return;
  }

  const rawVideoPath = await video.path();
  const destination = path.join(outputRoot, "journeys", `${opts.name}.webm`);
  await cp(rawVideoPath, destination);
  process.stdout.write(`[capture:journey] ${opts.name}\n`);
}

async function main() {
  await prepareOutput();

  const browser = await chromium.launch({ headless: true });
  const desktop = await createDesktopCapture(browser);
  const mobile = await createMobileCapture(browser);

  try {
    for (const target of targets) {
      await captureTarget(desktop, target);
      await captureTarget(mobile, target);
    }

    await captureSocialScreens(browser);
    await captureManifestScreens(browser);
    await recordJourney(browser, {
      name: "advertiser-desktop",
      viewport: { width: 1280, height: 720 },
    });
    await recordJourney(browser, {
      name: "advertiser-mobile",
      mobile: true,
      viewport: { width: 390, height: 844 },
    });
  } finally {
    await desktop.context.close();
    await mobile.context.close();
    await browser.close();
  }

  await writeFile(
    path.join(outputRoot, "metadata.json"),
    JSON.stringify(
      {
        baseUrl,
        outputRoot,
        capturedAt: new Date().toISOString(),
        targets,
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(latestPointer, outputRoot, "utf8");
  process.stdout.write(`Live capture complete: ${outputRoot}\n`);
}

main().catch((error) => {
  console.error("Live capture failed:", error);
  process.exit(1);
});
