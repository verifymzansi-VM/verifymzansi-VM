import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, devices, type Page } from "playwright";

const baseUrl =
  process.env.PUBLIC_VERIFY_BASE_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

if (!baseUrl) {
  throw new Error("PUBLIC_VERIFY_BASE_URL or APP_URL is required");
}

const requireRealTurnstile = process.env.PUBLIC_VERIFY_REQUIRE_TURNSTILE !== "0";
const allowCloudflareChallenge = process.env.PUBLIC_VERIFY_ALLOW_CLOUDFLARE_CHALLENGE === "1";
const turnstileTimeoutMs = Number(process.env.PUBLIC_VERIFY_TURNSTILE_TIMEOUT_MS || 30_000);
const artifactsDir = process.env.PUBLIC_VERIFY_ARTIFACTS_DIR || "test-results/public-verify";

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
  const consoleErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  // Listen for CSP violation reports via SecurityPolicyViolationEvent
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as Record<string, string[]>).__cspViolations =
        (window as unknown as Record<string, string[]>).__cspViolations || [];
      (window as unknown as Record<string, string[]>).__cspViolations.push(
        `${e.violatedDirective}: ${e.blockedURI}`
      );
    });
  });

  const unavailableCopy = page.getByText(/security verification is temporarily unavailable/i);
  const failedCopy = page.getByText(/security check failed/i);
  const iframeCount = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();
  const unavailableCount = await unavailableCopy.count();

  // Turnstile render is async and can take a few seconds on real deployments.
  // Wait up to the same window our auth pages use before declaring it missing.
  if (requireRealTurnstile && iframeCount === 0 && unavailableCount === 0) {
    const iframe = page.locator('iframe[src*="challenges.cloudflare.com"]');
    await Promise.race([
      iframe
        .first()
        .waitFor({ state: "attached", timeout: turnstileTimeoutMs })
        .catch(() => {}),
      unavailableCopy
        .first()
        .waitFor({ state: "visible", timeout: turnstileTimeoutMs })
        .catch(() => {}),
      failedCopy
        .first()
        .waitFor({ state: "visible", timeout: turnstileTimeoutMs })
        .catch(() => {}),
    ]);

    const iframeCountAfter = await iframe.count();
    const unavailableAfter = await unavailableCopy.count();
    const failedAfter = await failedCopy.count();

    if (iframeCountAfter === 0 && unavailableAfter === 0 && failedAfter === 0) {
      const diagnostics = await page.evaluate(() => {
        const el = document.getElementById("vmz-public-config");
        const turnstileSiteKey = el instanceof HTMLElement ? el.dataset.turnstileSiteKey || "" : "";
        const scriptTags = Array.from(document.querySelectorAll("script[src]")).map(
          (s) => (s as HTMLScriptElement).src
        );
        const turnstileScripts = scriptTags.filter((s) => s.includes("challenges.cloudflare"));
        const cspViolations = (window as unknown as Record<string, string[]>).__cspViolations || [];
        const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => f.src);
        return { turnstileSiteKey, turnstileScripts, iframes, cspViolations };
      });

      throw new Error(
        [
          "Auth page rendered without a Turnstile iframe or explicit unavailable state",
          `turnstileSiteKey=${diagnostics.turnstileSiteKey || "(missing)"}`,
          `sawFailureCopy=${failedAfter > 0}`,
          `turnstileScriptsLoaded=${diagnostics.turnstileScripts.length}`,
          `allIframes=${JSON.stringify(diagnostics.iframes)}`,
          `cspViolations=${JSON.stringify(diagnostics.cspViolations)}`,
          `consoleErrors=${JSON.stringify(consoleErrors.slice(0, 10))}`,
        ].join("; ")
      );
    }
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
  const promotionsTab = marketplaceTabs.getByRole("link", { name: "Tourism & Events" });

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

async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = (await page.title()).toLowerCase();
  if (title.includes("just a moment")) {
    return true;
  }

  const bodyText = (await page.locator("body").innerText()).toLowerCase();
  return (
    bodyText.includes("just a moment") ||
    bodyText.includes("checking your browser") ||
    bodyText.includes("challenges.cloudflare.com")
  );
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
      const status = response?.status() ?? 0;
      if (allowCloudflareChallenge && status === 403 && (await isCloudflareChallenge(page))) {
        report(
          `[WARN] ${target.name}: received Cloudflare challenge (HTTP 403). Skipping strict page assertions for this target.`
        );
        return;
      }

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
  } catch (error) {
    await mkdir(artifactsDir, { recursive: true });
    await page.screenshot({
      path: path.join(artifactsDir, `${target.name}.png`),
      fullPage: true,
    });
    throw error;
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
