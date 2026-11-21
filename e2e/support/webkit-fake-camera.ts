import { createRequire } from "node:module";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";

/**
 * Test-only fake camera for the WebKit browser project (mobile-safari).
 *
 * Chromium gets a fake camera from its launch flags; WebKit has no such flags,
 * and headless WebKit does not reliably show a canvas-capture stream in a
 * <video>, so a page waiting for the camera's first frame never gets one. This
 * adds webkit-fake-camera.page.js (what it does is described there) to every
 * browser context the WebKit browser opens in this test process: the default
 * `context`/`page` fixtures and contexts a spec opens itself with
 * browser.newContext(). Chromium and Firefox contexts are left alone.
 *
 * Specs import `test` from @playwright/test directly, so there is no shared
 * fixture to hang this on. It uses the test runner's own hook for "a browser
 * context was created" (the client instrumentation that tracing and
 * screenshots use), awaited before newContext() returns, so the script is in
 * place before the first page opens. If a Playwright upgrade removes that
 * hook, installing throws instead of letting camera specs fail obscurely.
 *
 * It lives under e2e/ only and is never imported by the website:
 * scripts/e2e-fake-camera-isolation.test.mjs enforces that.
 */
export const WEBKIT_FAKE_CAMERA_SCRIPT = path.join(__dirname, "webkit-fake-camera.page.js");

type ContextListener = {
  runAfterCreateBrowserContext?: (context: BrowserContext) => Promise<void>;
};
type Instrumentation = { addListener(listener: ContextListener): void };

/** The playwright-core instance the test runner uses (its `playwright` fixture). */
function runnerPlaywrightCore(): { _instrumentation?: Partial<Instrumentation> } {
  const fromRoot = createRequire(path.join(process.cwd(), "package.json"));
  const fromTest = createRequire(fromRoot.resolve("@playwright/test/package.json"));
  const fromPlaywright = createRequire(fromTest.resolve("playwright/package.json"));
  return fromPlaywright("playwright-core");
}

const INSTALLED = Symbol.for("verifymzansi.webkitFakeCamera.installed");

/** Adds the fake camera to every WebKit browser context in this process (once). */
export function installWebKitFakeCamera() {
  const registry = globalThis as { [INSTALLED]?: boolean };
  if (registry[INSTALLED]) return;
  const instrumentation = runnerPlaywrightCore()._instrumentation;
  if (typeof instrumentation?.addListener !== "function")
    throw new Error(
      "WebKit fake camera: Playwright no longer exposes its context hook " +
        "(playwright-core _instrumentation.addListener); update e2e/support/webkit-fake-camera.ts."
    );
  instrumentation.addListener({
    runAfterCreateBrowserContext: async (context) => {
      if (context.browser()?.browserType().name() !== "webkit") return;
      await context.addInitScript({ path: WEBKIT_FAKE_CAMERA_SCRIPT });
    },
  });
  registry[INSTALLED] = true;
}
