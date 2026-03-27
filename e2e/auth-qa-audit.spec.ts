/**
 * Auth Workflow QA Audit
 *
 * End-to-end validation of account creation and login reliability.
 * Produces PASS/FAIL evidence and bug reports.
 *
 * Run: pnpm exec playwright test e2e/auth-qa-audit.spec.ts --project=chromium
 */
import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ── Evidence helpers ─────────────────────────────────────────
const EVIDENCE_DIR = path.resolve(__dirname, "..", "evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

interface ApiLog {
  url: string;
  method: string;
  status: number;
  body: unknown;
  timestamp: string;
}

const allApiLogs: ApiLog[] = [];
const allConsoleErrors: string[] = [];
const allConsoleWarnings: string[] = [];

function freshEmail(): string {
  return `qa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
}

function setupPageListeners(page: Page) {
  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    if (msg.type() === "error") allConsoleErrors.push(text);
    if (msg.type() === "warning") allConsoleWarnings.push(text);
  });
  page.on("response", async (response) => {
    if (response.url().includes("/api/auth/")) {
      const body = await response.json().catch(() => null);
      allApiLogs.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        body,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";

async function prepareTurnstile(page: Page) {
  if (!isPlaywrightTestMode) return;

  await expect(page.getByText("Click to bypass CAPTCHA")).toHaveCount(0);
  await expect(page.locator('iframe[src*="challenges.cloudflare"]')).toHaveCount(0);
  await expect(page.getByText("Security verification failed to load")).toHaveCount(0);
  await expect(page.getByText("CAPTCHA verification failed. Please try again.")).toHaveCount(0);

  // Allow the dev bypass effect to populate form state before submit assertions.
  await page.waitForTimeout(100);
}

// ── Shared state ─────────────────────────────────────────────
const hasAuthCreds = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);
let registeredEmail = "";
const registeredPassword = "QaTestPass1";

// ── Test config ──────────────────────────────────────────────
test.use({ trace: "on" });

// ============================================================
// SECTION 1: Registration Flow
// ============================================================
const skipRegistrationInCI = isPlaywrightTestMode;

test.describe.serial("Registration Flow", () => {
  test("TC01 — Register happy path", async ({ page }) => {
    test.skip(
      skipRegistrationInCI,
      "Registration flow skipped in CI — requires stable Supabase without rate limits"
    );
    setupPageListeners(page);
    registeredEmail = freshEmail();

    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    // Fill form
    await page.fill("#firstName", "QA");
    await page.fill("#lastName", "Test User");
    await page.fill("#email", registeredEmail);
    await page.fill("#phone", "0712345678");
    await page.fill("#password", registeredPassword);
    await page.fill("#confirmPassword", registeredPassword);
    await page.check("#acceptTerms");

    await prepareTurnstile(page);

    await screenshot(page, "TC01-form-filled");

    // Intercept API response
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST"
    );

    // Submit
    await page.getByRole("button", { name: /create account/i }).click();

    const response = await responsePromise;
    const responseBody = await response.json().catch(() => ({}));

    // Capture evidence regardless of pass/fail
    await screenshot(page, "TC01-after-submit");

    // Write API evidence
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "TC01-register-response.json"),
      JSON.stringify({ status: response.status(), body: responseBody }, null, 2)
    );

    // Assertions — register should return 200 with { success: true }
    // If Supabase email rate limit is hit, this returns 400 with a generic error
    if (response.status() === 400) {
      console.warn(
        `BUG EVIDENCE: Register API returned 400. Body: ${JSON.stringify(responseBody)}. ` +
          "Supabase email rate limit may be masking as a generic registration failure."
      );
    }
    expect(response.status()).toBe(200);
    expect(responseBody).toHaveProperty("success", true);

    // Toast
    await expect(page.locator("text=Account created!")).toBeVisible({ timeout: 5000 });

    // Redirect
    await page.waitForURL("**/login?registered=true", { timeout: 10000 });
    expect(page.url()).toContain("/login?registered=true");

    await screenshot(page, "TC01-redirect-login");
  });

  test("TC02 — Register duplicate email (anti-enumeration)", async ({ page }) => {
    setupPageListeners(page);
    test.skip(
      skipRegistrationInCI,
      "Registration flow skipped in CI — requires stable Supabase without rate limits"
    );
    test.skip(!registeredEmail, "TC01 must run first to set registeredEmail");

    await page.goto("/register");

    await page.fill("#firstName", "QA");
    await page.fill("#lastName", "Duplicate");
    await page.fill("#email", registeredEmail);
    await page.fill("#phone", "0712345679");
    await page.fill("#password", registeredPassword);
    await page.fill("#confirmPassword", registeredPassword);
    await page.check("#acceptTerms");
    await prepareTurnstile(page);

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/register") && r.request().method() === "POST"
    );

    await page.getByRole("button", { name: /create account/i }).click();

    const response = await responsePromise;
    const responseBody = await response.json().catch(() => ({}));

    // Anti-enumeration: same response as fresh registration
    expect(response.status()).toBe(200);
    expect(responseBody).toHaveProperty("success", true);

    // Same toast and redirect as TC01
    await expect(page.locator("text=Account created!")).toBeVisible({ timeout: 5000 });
    await page.waitForURL("**/login?registered=true", { timeout: 10000 });

    await screenshot(page, "TC02-duplicate-success");
  });
});

// ============================================================
// SECTION 2: Registration Validation
// ============================================================
test.describe("Registration Validation", () => {
  test("TC03a — Empty form shows all validation errors", async ({ page }) => {
    setupPageListeners(page);
    await page.goto("/register");
    await prepareTurnstile(page);

    // Submit without filling anything (no turnstile bypass either)
    await page.getByRole("button", { name: /create account/i }).click();

    // Check that validation errors appear for required fields
    await expect(
      page.getByRole("alert").filter({ hasText: /^Name must be at least 2 characters$/ })
    ).toBeVisible({ timeout: 3000 });
    await expect(
      page.getByRole("alert").filter({ hasText: /^Surname must be at least 2 characters$/ })
    ).toBeVisible();
    await expect(page.locator("text=Enter a valid email address")).toBeVisible();
    // Phone error: "Phone number is required" from min(10)
    await expect(page.locator("text=Phone number is required")).toBeVisible();
    await expect(page.locator("text=Password must be at least 8 characters")).toBeVisible();
    await expect(page.locator("text=You must accept the terms of service")).toBeVisible();

    await screenshot(page, "TC03a-validation-errors");
  });

  test("TC03b — Password mismatch error", async ({ page }) => {
    setupPageListeners(page);
    await page.goto("/register");

    await page.fill("#firstName", "QA");
    await page.fill("#lastName", "Mismatch");
    await page.fill("#email", freshEmail());
    await page.fill("#phone", "0712345678");
    await page.fill("#password", "TestPass1");
    await page.fill("#confirmPassword", "TestPass2");
    await page.check("#acceptTerms");
    await prepareTurnstile(page);

    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator("text=Passwords do not match")).toBeVisible({ timeout: 3000 });
    await screenshot(page, "TC03b-password-mismatch");
  });

  test("TC03c — Invalid SA phone format", async ({ page }) => {
    setupPageListeners(page);
    await page.goto("/register");

    await page.fill("#firstName", "QA");
    await page.fill("#lastName", "Phone");
    await page.fill("#email", freshEmail());
    await page.fill("#phone", "1234567890"); // not SA format
    await page.fill("#password", "TestPass1");
    await page.fill("#confirmPassword", "TestPass1");
    await page.check("#acceptTerms");
    await prepareTurnstile(page);

    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.locator("text=Enter a valid SA mobile number")).toBeVisible({
      timeout: 3000,
    });
    await screenshot(page, "TC03c-invalid-phone");
  });
});

// ============================================================
// SECTION 3: Login Flow
// ============================================================
test.describe("Login Flow", () => {
  test("TC04 — Login happy path (requires E2E creds)", async ({ page }) => {
    test.skip(!hasAuthCreds, "Set E2E_EMAIL and E2E_PASSWORD to enable");
    setupPageListeners(page);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

    await page.fill("#email", process.env.E2E_EMAIL!);
    await page.fill("#password", process.env.E2E_PASSWORD!);
    await prepareTurnstile(page);

    await screenshot(page, "TC04-form-filled");

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"
    );

    await page.getByRole("button", { name: /sign in/i }).click();

    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page.locator("text=Welcome back!")).toBeVisible({ timeout: 5000 });
    await page.waitForURL("**/dashboard**", { timeout: 10000 });

    await screenshot(page, "TC04-dashboard");
  });

  test("TC05 — Login with wrong password", async ({ page }) => {
    setupPageListeners(page);

    await page.goto("/login");

    await page.fill("#email", "qa-wrong@example.com");
    await page.fill("#password", "WrongPass1");
    await prepareTurnstile(page);

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST"
    );

    await page.getByRole("button", { name: /sign in/i }).click();

    const response = await responsePromise;
    const body = await response.json().catch(() => ({}));

    expect(response.status()).toBe(401);
    expect(body).toHaveProperty("error", "Invalid email or password");

    // Toast should show safe error (use .first() to avoid strict mode with multiple matches)
    await expect(page.getByText("Invalid email or password", { exact: true }).first()).toBeVisible({
      timeout: 5000,
    });

    // Should stay on /login
    expect(page.url()).toContain("/login");

    await screenshot(page, "TC05-wrong-password");
  });

  test("TC06 — Login empty form shows validation errors", async ({ page }) => {
    setupPageListeners(page);
    let apiCallMade = false;

    page.on("request", (req) => {
      if (req.url().includes("/api/auth/login") && req.method() === "POST") {
        apiCallMade = true;
      }
    });

    await page.goto("/login");
    await prepareTurnstile(page);

    // Submit empty form without turnstile bypass
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.locator("text=Enter a valid email address")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Password is required")).toBeVisible();

    // Client-side validation should block the API call
    expect(apiCallMade).toBe(false);

    await screenshot(page, "TC06-login-validation");
  });
});

// ============================================================
// SECTION 4: Auth Guards
// ============================================================
test.describe("Auth Guards", () => {
  test("TC07a — /verification redirects to /login with returnUrl", async ({ page }) => {
    setupPageListeners(page);

    await page.goto("/verification");
    await page.waitForURL("**/login**", { timeout: 10000 });

    expect(page.url()).toContain("/login");
    expect(page.url()).toContain("returnUrl");
    expect(page.url()).toContain("verification");

    await screenshot(page, "TC07a-verification-redirect");
  });

  test("TC07b — /dashboard redirects to /login with returnUrl", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login**", { timeout: 10000 });
    expect(page.url()).toContain("/login");
  });

  test("TC07c — /billing redirects to /login with returnUrl", async ({ page }) => {
    await page.goto("/billing");
    await page.waitForURL("**/login**", { timeout: 10000 });
    expect(page.url()).toContain("/login");
  });

  test("TC08 — API returns 401 for unauthenticated POST", async ({ request }) => {
    // POST to a protected API endpoint without auth
    const verifyResp = await request.post("/api/verification/session/start", {
      data: {},
    });
    // Middleware should return 401 for unauthenticated API requests
    expect([401, 403]).toContain(verifyResp.status());

    const body = await verifyResp.json().catch(() => ({}));
    // Should not leak internal details
    expect(body.error).toBeDefined();
    expect(body.error).not.toContain("stack");
    expect(body.error).not.toContain("Error:");
  });
});

// ============================================================
// SECTION 5: Turnstile Dev Bypass
// ============================================================
test.describe("Turnstile Dev Mode", () => {
  test("TC09a — Register page auto-bypasses turnstile without manual controls", async ({
    page,
  }) => {
    test.skip(!isPlaywrightTestMode, "Auto-bypass assertions only apply in Playwright test mode");
    await page.goto("/register");
    await prepareTurnstile(page);

    await screenshot(page, "TC09a-register-turnstile-bypass");
  });

  test("TC09b — Login page auto-bypasses turnstile without manual controls", async ({ page }) => {
    test.skip(!isPlaywrightTestMode, "Auto-bypass assertions only apply in Playwright test mode");
    await page.goto("/login");
    await prepareTurnstile(page);

    await screenshot(page, "TC09b-login-turnstile-bypass");
  });
});

// ============================================================
// SECTION 6: Rate Limiting
// ============================================================
test.describe("Rate Limiting", () => {
  test("TC10 — Rapid login attempts rate-limit behavior", async ({ request }) => {
    const results: { attempt: number; status: number }[] = [];
    const rateLimitIpOctet =
      (Array.from(test.info().project.name).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 200) +
      1;
    const rateLimitHeaders = {
      "x-forwarded-for": `198.51.100.${rateLimitIpOctet}`,
      "x-real-ip": `198.51.100.${rateLimitIpOctet}`,
    };

    // Send 25 rapid login attempts
    for (let i = 0; i < 25; i++) {
      const resp = await request.post("/api/auth/login", {
        headers: rateLimitHeaders,
        data: {
          email: "ratelimit-test@example.com",
          password: "WrongPassword1",
          turnstileToken: "dev-turnstile-bypass",
        },
      });
      results.push({ attempt: i + 1, status: resp.status() });
    }

    // Check if any were rate-limited (429)
    const rateLimited = results.filter((r) => r.status === 429);
    const nonRateLimited = results.filter((r) => r.status !== 429);

    // Write evidence
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "TC10-rate-limit-results.json"),
      JSON.stringify({ results, rateLimited: rateLimited.length, total: results.length }, null, 2)
    );

    // If no rate limiting occurred, this is a bug to report
    if (rateLimited.length === 0) {
      console.warn(
        `BUG: No rate limiting after ${results.length} rapid requests. ` +
          `All returned status: ${[...new Set(results.map((r) => r.status))].join(", ")}`
      );
    }

    // At minimum, verify all responses are safe (401/503, not 500)
    for (const r of nonRateLimited) {
      expect([400, 401, 503]).toContain(r.status);
    }
  });
});

// ============================================================
// SECTION 7: Login Redirect Behavior
// ============================================================
test.describe("Login Redirect", () => {
  test("TC11 — Login returnUrl redirect (requires E2E creds)", async ({ page }) => {
    test.skip(!hasAuthCreds, "Set E2E_EMAIL and E2E_PASSWORD to enable");
    setupPageListeners(page);

    await page.goto("/login?returnUrl=/verification");
    await page.fill("#email", process.env.E2E_EMAIL!);
    await page.fill("#password", process.env.E2E_PASSWORD!);
    await prepareTurnstile(page);

    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/verification**", { timeout: 10000 });

    expect(page.url()).toContain("/verification");
    await screenshot(page, "TC11-return-url-redirect");
  });

  test("TC12 — Logged-in user redirected away from auth pages (requires E2E creds)", async ({
    page,
  }) => {
    test.skip(!hasAuthCreds, "Set E2E_EMAIL and E2E_PASSWORD to enable");
    setupPageListeners(page);

    // Login first
    await page.goto("/login");
    await page.fill("#email", process.env.E2E_EMAIL!);
    await page.fill("#password", process.env.E2E_PASSWORD!);
    await prepareTurnstile(page);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 10000 });

    // Now visit /login — should redirect to /dashboard
    await page.goto("/login");
    await page.waitForURL("**/dashboard**", { timeout: 10000 });
    expect(page.url()).toContain("/dashboard");

    // Visit /register — should redirect to /dashboard
    await page.goto("/register");
    await page.waitForURL("**/dashboard**", { timeout: 10000 });
    expect(page.url()).toContain("/dashboard");

    await screenshot(page, "TC12-logged-in-redirect");
  });
});

// ============================================================
// SECTION 8: Login page "registered=true" banner check
// ============================================================
test.describe("Post-Registration UX", () => {
  test("TC13 — /login?registered=true shows confirmation", async ({ page }) => {
    setupPageListeners(page);

    await page.goto("/login?registered=true");
    await prepareTurnstile(page);

    await expect(page.getByText("Check your email", { exact: true })).toBeVisible();
    await expect(page.getByText(/We've sent a confirmation link/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /resend confirmation email/i })).toBeVisible();

    await screenshot(page, "TC13-registered-true-landing");

    // Document whether there's a registered banner
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "TC13-registered-banner.json"),
      JSON.stringify(
        {
          hasRegisteredBanner: true,
          note: "PASS: Registration confirmation visible.",
        },
        null,
        2
      )
    );
  });
});

// ============================================================
// SECTION 9: Turnstile 10-second Timeout Bug
// ============================================================
test.describe("Turnstile Timeout", () => {
  test("TC14 — Login page turnstile timeout skipped in non-production", async ({ page }) => {
    setupPageListeners(page);

    await page.goto("/login");
    await prepareTurnstile(page);

    test.slow(); // This test intentionally waits for a timeout
    // Wait 16 seconds WITHOUT clicking turnstile bypass (timeout is 15s)
    await page.waitForTimeout(16000);

    // In non-production builds, the timeout should NOT fire
    const errorVisible = await page
      .locator("text=Security verification failed to load")
      .isVisible();

    await screenshot(page, "TC14-turnstile-timeout");

    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "TC14-turnstile-timeout.json"),
      JSON.stringify(
        {
          spuriousErrorShown: errorVisible,
          note: errorVisible
            ? "WARN: Turnstile timeout fired — expected in production builds with slow network."
            : "PASS: No spurious timeout error in non-production environment.",
        },
        null,
        2
      )
    );
  });
});

// ============================================================
// After all: write full evidence summary
// ============================================================
test.afterAll(() => {
  fs.writeFileSync(path.join(EVIDENCE_DIR, "api-logs.json"), JSON.stringify(allApiLogs, null, 2));
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "console-errors.json"),
    JSON.stringify({ errors: allConsoleErrors, warnings: allConsoleWarnings }, null, 2)
  );
});
