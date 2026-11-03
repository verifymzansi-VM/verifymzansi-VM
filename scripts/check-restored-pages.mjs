import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.RESTORED_PAGES_BASE_URL || "http://localhost:3000";
const output = process.env.RESTORED_PAGES_OUTPUT || "test-results/restored-pages";
await mkdir(output, { recursive: true });
const defaultPaths = [
  "/",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions/events",
  "/search?q=coffee",
  "/pricing",
  "/pricing/multi-listing",
  "/sponsors",
  "/advertise",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/contact",
  "/help",
  "/help/showroom",
  "/help/verification",
  "/help/business-verification",
  "/trust-safety",
  "/safety",
  "/terms",
  "/privacy",
  "/paia",
  "/install",
  "/offline",
];
const paths = process.env.RESTORED_PAGES_PATHS
  ? JSON.parse(process.env.RESTORED_PAGES_PATHS)
  : defaultPaths;
if (
  !Array.isArray(paths) ||
  paths.some((path) => typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))
)
  throw new Error("Expected local page paths");
async function duringDevRestart(action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        attempt >= 7 ||
        !/ECONNREFUSED|ERR_CONNECTION_REFUSED|ECONNRESET|ERR_CONNECTION_RESET/.test(error.message)
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
const browser = await chromium.launch({ headless: true });
const results = [];
const internal = new Set();
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 1000 } }),
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const path of mobile ? paths.slice(0, 6) : paths) {
      const errors = [],
        failed = [];
      const pageError = (error) => errors.push(error.message);
      const responseError = (response) => {
        if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin)
          failed.push({ url: new URL(response.url()).pathname, status: response.status() });
      };
      page.on("pageerror", pageError);
      page.on("response", responseError);
      try {
        const response = await duringDevRestart(() =>
          page.goto(base + path, {
            waitUntil: "domcontentloaded",
            timeout: 180000,
          })
        );
        await page.locator("body").waitFor();
        if (["/mzansi-market", "/mzansi-business", "/tourism-events"].includes(path)) {
          await page
            .locator('[data-testid$="-grid-loading"]')
            .waitFor({ state: "detached", timeout: 120000 });
          await page
            .locator(
              '[data-testid$="-grid-ready"], [data-testid$="-grid-empty"], [role="tabpanel"]'
            )
            .first()
            .waitFor({ timeout: 120000 });
        }
        const launch = page.getByRole("button", { name: "Explore the site" });
        if (await launch.isVisible()) await launch.click();
        // Wait for the grids' network reads and hydration, not animations.
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        const text = await page.locator("body").innerText();
        const links = await page
          .locator('a[href^="/"]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
        for (const href of links)
          if (href && !href.startsWith("//")) internal.add(href.split("#")[0]);
        const result = {
          path,
          mobile,
          status: response?.status(),
          title: await page.title(),
          errorScreen:
            /Application error:|Something went wrong|Invalid schema: public|Could not load (listings|businesses|events)/i.test(
              text
            ),
          errors,
          failed,
        };
        if (paths.indexOf(path) < 5) {
          result.horizontalOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth + 1
          );
          await page.screenshot({
            path: `${output}/${mobile ? "mobile" : "desktop"}-${path === "/" ? "home" : path.replaceAll("/", "-").slice(1)}.png`,
            fullPage: true,
          });
        }
        results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        const result = { path, mobile, error: error.message };
        results.push(result);
        console.log(JSON.stringify(result));
      }
      page.off("pageerror", pageError);
      page.off("response", responseError);
    }
    await context.close();
  }
  const context = await browser.newContext();
  for (const path of [
    "/dashboard",
    "/admin",
    "/post/create-listing",
    "/post/create-business",
    "/post/create-tourism",
    "/billing",
    "/verification",
  ]) {
    const response = await duringDevRestart(() =>
      context.request.get(base + path, { maxRedirects: 0, timeout: 120000 })
    );
    const result = { path, status: response.status(), redirect: response.headers().location };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const checked = new Set(paths.map((path) => path.split("?")[0]));
  for (const href of internal) {
    if (
      checked.has(href.split("?")[0]) ||
      href.startsWith("/api/") ||
      /\.[a-z0-9]+(?:\?|$)/i.test(href)
    )
      continue;
    checked.add(href.split("?")[0]);
    const response = await duringDevRestart(() =>
      context.request.get(base + href, { maxRedirects: 0, timeout: 120000 })
    );
    const result = {
      linkedPath: href,
      status: response.status(),
      redirect: response.headers().location,
    };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await context.close();
} finally {
  await browser.close();
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
}
// /help has no index in the selected frontend; its individual help pages are
// linked directly. Keep this as a negative test of the existing 404 handling.
if (
  results.some((result) => {
    const expected404 = result.path === "/help" && result.status === 404;
    return (
      result.error ||
      (!expected404 && result.status >= 400) ||
      result.errorScreen ||
      result.errors?.length ||
      result.failed?.some(
        (failure) => !(expected404 && failure.url === "/help" && failure.status === 404)
      ) ||
      result.horizontalOverflow
    );
  })
)
  process.exitCode = 1;
