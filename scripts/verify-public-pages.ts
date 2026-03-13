import { chromium, devices, type Page } from "playwright";

const baseUrl =
  process.env.PUBLIC_VERIFY_BASE_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!baseUrl) {
  throw new Error("PUBLIC_VERIFY_BASE_URL or APP_URL is required");
}

const requireRealTurnstile = process.env.PUBLIC_VERIFY_REQUIRE_TURNSTILE !== "0";

function report(message: string) {
  process.stdout.write(`${message}\n`);
}

type Target = {
  name: string;
  path: string;
  device?: (typeof devices)["Pixel 7"];
  expectAuthUi?: boolean;
  expectMobileFooter?: boolean;
};

const targets: Target[] = [
  { name: "home-desktop", path: "/" },
  { name: "login-desktop", path: "/login", expectAuthUi: true },
  { name: "register-desktop", path: "/register", expectAuthUi: true },
  { name: "pricing-desktop", path: "/pricing" },
  { name: "market-desktop", path: "/mzansi-market" },
  {
    name: "business-mobile",
    path: "/mzansi-business",
    device: devices["Pixel 7"],
    expectMobileFooter: true,
  },
  { name: "login-mobile", path: "/login", device: devices["Pixel 7"], expectAuthUi: true },
];

function collectHydrationErrors(page: Page) {
  const hydrationErrors: string[] = [];

  page.on("console", (msg) => {
    if (
      msg.type() === "error" &&
      /hydration|server rendered html didn't match|minified react error #418/i.test(msg.text())
    ) {
      hydrationErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    if (/hydration|minified react error #418/i.test(error.message)) {
      hydrationErrors.push(error.message);
    }
  });

  return hydrationErrors;
}

async function assertAuthUi(page: Page) {
  const unavailableCopy = page.getByText(/security verification is temporarily unavailable/i);
  const iframeCount = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();
  const unavailableCount = await unavailableCopy.count();

  if (requireRealTurnstile && iframeCount === 0 && unavailableCount === 0) {
    throw new Error("Auth page rendered without a Turnstile iframe or explicit unavailable state");
  }

  await page
    .getByRole("button", { name: /sign in|create account/i })
    .first()
    .isVisible();
}

async function assertMobileFooter(page: Page) {
  const marketplaceTabs = page.getByRole("navigation", { name: "Marketplace areas" });
  const marketTab = marketplaceTabs.getByRole("link", { name: "Mzansi Market" });
  const businessTab = marketplaceTabs.getByRole("link", { name: "Mzansi Business" });
  const promotionsTab = marketplaceTabs.getByRole("link", { name: "Promotions & Events" });

  await marketTab.waitFor({ state: "visible", timeout: 15_000 });
  await businessTab.waitFor({ state: "visible", timeout: 15_000 });
  await promotionsTab.waitFor({ state: "visible", timeout: 15_000 });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(250);

  const footerLink = page.getByRole("link", { name: "Privacy Policy" });
  const bottomNav = page.getByRole("navigation", { name: "Main" });

  await footerLink.waitFor({ state: "visible", timeout: 15_000 });
  await bottomNav.waitFor({ state: "visible", timeout: 15_000 });

  const footerBottom = await footerLink.evaluate(
    (element) => element.getBoundingClientRect().bottom
  );
  const navTop = await bottomNav.evaluate((element) => element.getBoundingClientRect().top);

  if (footerBottom > navTop) {
    throw new Error("Footer content overlaps the fixed bottom navigation on mobile");
  }
}

async function openTarget(target: Target) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(target.device ?? {});
  return { browser, context };
}

async function verifyTarget(target: Target) {
  const { browser, context } = await openTarget(target);
  const page = await context.newPage();
  const hydrationErrors = collectHydrationErrors(page);

  try {
    const response = await page.goto(new URL(target.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    if (!response || response.status() >= 400) {
      throw new Error(
        `Unexpected status for ${target.path}: ${response?.status() ?? "no response"}`
      );
    }

    await page.waitForTimeout(2_000);

    if (hydrationErrors.length > 0) {
      throw new Error(`Hydration errors detected: ${hydrationErrors[0]}`);
    }

    if (target.expectAuthUi) {
      await assertAuthUi(page);
    }

    if (target.expectMobileFooter) {
      await assertMobileFooter(page);
    }

    report(`[OK] ${target.name}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  report(`Verifying public/auth pages at ${baseUrl}`);

  for (const target of targets) {
    await verifyTarget(target);
  }

  report("Public/auth verification passed.");
}

main().catch((error) => {
  console.error("Public/auth verification failed:", error);
  process.exit(1);
});
