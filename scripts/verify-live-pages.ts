import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  devices,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Cookie,
  type Page,
} from "playwright";

type SessionScope = "public" | "user" | "admin";
type ExtraScope = SessionScope | "boundary";
type DeviceProfile = "desktop" | "mobile";
type RouteStatus = "pass" | "fail" | "skip";
type CustomCheck = "auth-ui" | "mobile-footer";

type RouteTarget = {
  name: string;
  path: string;
  scope: SessionScope;
  device?: DeviceProfile;
  readySelectors?: string[];
  titleIncludes?: string[];
  bodyIncludes?: string[];
  bodyIncludesAny?: string[];
  bodyRegexes?: RegExp[];
  forbiddenBodyIncludes?: string[];
  expectedUrlPattern?: RegExp;
  customChecks?: CustomCheck[];
};

type BoundaryCheck = {
  name: string;
  path: string;
  expectedUrlPattern: RegExp;
};

type DynamicDiscovery = {
  name: string;
  sourcePath: string;
  match: RegExp;
  titleIncludes?: string[];
};

type SessionAvailability = {
  available: boolean;
  reason?: string;
};

type ConsoleCapture = {
  consoleErrors: string[];
  pageErrors: string[];
  failedApiResponses: string[];
  non2xxRequests: Array<{ method: string; url: string; status?: number; resourceType: string }>;
};

type RouteResult = {
  name: string;
  scope: SessionScope | "boundary";
  path: string;
  status: RouteStatus;
  device: DeviceProfile;
  finalUrl?: string;
  documentStatus?: number;
  title?: string;
  readySelector?: string;
  notes: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedApiResponses: string[];
  non2xxRequests: Array<{ method: string; url: string; status?: number; resourceType: string }>;
};

type RuntimeIssue = {
  kind: "console" | "pageerror" | "request" | "api";
  detail: string;
};

const rawArgs = new Set(process.argv.slice(2));
const baseUrl =
  process.env.LIVE_VERIFY_BASE_URL ||
  process.env.PUBLIC_VERIFY_BASE_URL ||
  process.env.APP_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://verifymzansi.com";
const loadSettleMs = Number(process.env.LIVE_VERIFY_LOAD_SETTLE_MS || "2500");
const readyTimeoutMs = Number(process.env.LIVE_VERIFY_READY_TIMEOUT_MS || "15000");
const artifactsDir =
  process.env.LIVE_VERIFY_ARTIFACTS_DIR ||
  process.env.PUBLIC_VERIFY_ARTIFACTS_DIR ||
  "test-results/live-page-verify";
const requireRealTurnstile = process.env.PUBLIC_VERIFY_REQUIRE_TURNSTILE !== "0";
const turnstileTimeoutMs = Number(process.env.PUBLIC_VERIFY_TURNSTILE_TIMEOUT_MS || 30000);

const PUBLIC_ROUTE_TARGETS: RouteTarget[] = [
  {
    name: "home-desktop",
    path: "/",
    scope: "public",
    readySelectors: ["main"],
    titleIncludes: ["VerifyMzansi"],
    bodyIncludes: ["Mzansi Market", "Mzansi Business", "Tourism & Events"],
  },
  {
    name: "home-mobile",
    path: "/",
    scope: "public",
    device: "mobile",
    readySelectors: ["main"],
    titleIncludes: ["VerifyMzansi"],
  },
  {
    name: "mzansi-market-desktop",
    path: "/mzansi-market",
    scope: "public",
    readySelectors: [
      '[data-testid="mzansi-market-grid-ready"]',
      '[data-testid="mzansi-market-grid-empty"]',
      'h1:has-text("Browse Listings")',
    ],
    titleIncludes: ["Mzansi Market"],
    bodyIncludes: ["Browse Listings"],
  },
  {
    name: "mzansi-market-mobile",
    path: "/mzansi-market",
    scope: "public",
    device: "mobile",
    readySelectors: [
      '[data-testid="mzansi-market-grid-ready"]',
      '[data-testid="mzansi-market-grid-empty"]',
      'h1:has-text("Browse Listings")',
    ],
    titleIncludes: ["Mzansi Market"],
    customChecks: ["mobile-footer"],
  },
  {
    name: "mzansi-business-desktop",
    path: "/mzansi-business",
    scope: "public",
    readySelectors: [
      '[data-testid="mzansi-business-grid-ready"]',
      '[data-testid="mzansi-business-grid-empty"]',
      'h1:has-text("Mzansi Business")',
    ],
    titleIncludes: ["Mzansi Business"],
    bodyIncludes: ["Mzansi Business"],
  },
  {
    name: "mzansi-business-mobile",
    path: "/mzansi-business",
    scope: "public",
    device: "mobile",
    readySelectors: [
      '[data-testid="mzansi-business-grid-ready"]',
      '[data-testid="mzansi-business-grid-empty"]',
      'h1:has-text("Mzansi Business")',
    ],
    titleIncludes: ["Mzansi Business"],
    customChecks: ["mobile-footer"],
  },
  {
    name: "tourism-events-desktop",
    path: "/tourism-events",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Tourism & Events")'],
    titleIncludes: ["Tourism & Events"],
    bodyIncludes: ["Tourism & Events"],
  },
  {
    name: "promotions-desktop",
    path: "/promotions",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Tourism & Events")'],
    titleIncludes: ["Tourism & Events"],
    bodyIncludes: ["Tourism & Events"],
  },
  {
    name: "promotions-events-desktop",
    path: "/promotions/events",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Events")'],
    titleIncludes: ["Events"],
    bodyIncludes: ["Events"],
  },
  {
    name: "advertise-desktop",
    path: "/advertise",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Advertise on VerifyMzansi")'],
    titleIncludes: ["Advertise"],
    bodyIncludes: ["Advertise on VerifyMzansi", "Why advertise here"],
  },
  {
    name: "pricing-desktop",
    path: "/pricing",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Pricing")'],
    titleIncludes: ["Pricing"],
    bodyIncludesAny: [
      "Start free, compare each surface clearly",
      "2 free posts per area every 7 days",
      "Mzansi Market Basic",
    ],
  },
  {
    name: "contact-desktop",
    path: "/contact",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Contact Us")'],
    bodyIncludes: ["Contact Us"],
  },
  {
    name: "trust-safety-desktop",
    path: "/trust-safety",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Trust & Safety")'],
    titleIncludes: ["Trust & Safety"],
    bodyIncludes: ["Trust & Safety", "Verification helps reduce risk"],
  },
  {
    name: "safety-centre-desktop",
    path: "/safety",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Safety Centre")'],
    titleIncludes: ["Safety Centre"],
    bodyIncludes: ["Safety Centre", "Reports, disputes, and appeals"],
  },
  {
    name: "privacy-desktop",
    path: "/privacy",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Privacy Policy")'],
    titleIncludes: ["Privacy Policy"],
    bodyIncludes: ["Privacy Policy", "Your Rights Under POPIA"],
  },
  {
    name: "terms-desktop",
    path: "/terms",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Terms of Service")'],
    titleIncludes: ["Terms of Service"],
    bodyIncludes: ["Terms of Service", "Acceptance of Terms"],
  },
  {
    name: "verify-buyer-desktop",
    path: "/verify-buyer",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Verify a Buyer")'],
    bodyIncludes: ["Verify a Buyer", "Buyer Token Check"],
  },
  {
    name: "help-verification-desktop",
    path: "/help/verification",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Verification Help")'],
    titleIncludes: ["Verification Help"],
    bodyIncludes: ["Verification Help", "Blurry Image"],
  },
  {
    name: "safety-scam-alerts-desktop",
    path: "/safety/scam-alerts",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Scam Alerts")'],
    titleIncludes: ["Scam Alerts"],
    bodyIncludes: ["Scam Alerts", "If you've been scammed"],
  },
  {
    name: "safety-meeting-checklist-desktop",
    path: "/safety/meeting-checklist",
    scope: "public",
    readySelectors: ["main", 'h1:has-text("Meeting Safety Checklist")'],
    titleIncludes: ["Meeting Safety Checklist"],
    bodyIncludes: ["Meeting Safety Checklist", "Before"],
  },
  {
    name: "login-desktop",
    path: "/login",
    scope: "public",
    readySelectors: ["form:visible", 'h1:has-text("Sign in to your account")'],
    bodyIncludes: ["Sign in to your account"],
    customChecks: ["auth-ui"],
  },
  {
    name: "register-desktop",
    path: "/register",
    scope: "public",
    readySelectors: ["form:visible", 'h1:has-text("Create your account")'],
    bodyIncludes: ["Create your account"],
    customChecks: ["auth-ui"],
  },
  {
    name: "forgot-password-desktop",
    path: "/forgot-password",
    scope: "public",
    readySelectors: [
      "form:visible",
      'h1:has-text("Forgot your password?")',
      'h1:has-text("Check your email")',
    ],
    bodyIncludesAny: ["Forgot your password?", "Check your email"],
  },
  {
    name: "reset-password-desktop",
    path: "/reset-password",
    scope: "public",
    readySelectors: [
      "form:visible",
      'h1:has-text("Set a new password")',
      'h1:has-text("Reset link expired")',
    ],
    bodyIncludesAny: ["Set a new password", "Reset link expired"],
  },
  {
    name: "business-ads-redirect",
    path: "/business-ads",
    scope: "public",
    readySelectors: ["main"],
    expectedUrlPattern: /\/mzansi-business(?:\?|$)/i,
    titleIncludes: ["Mzansi Business"],
  },
  {
    name: "mall-shops-redirect",
    path: "/mall-shops",
    scope: "public",
    readySelectors: ["main"],
    expectedUrlPattern: /\/mzansi-business\?type=mall_store/i,
    titleIncludes: ["Mzansi Business"],
  },
];

const USER_ROUTE_TARGETS: RouteTarget[] = [
  {
    name: "dashboard-home",
    path: "/dashboard",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("Hi,")'],
    titleIncludes: ["Dashboard"],
    bodyRegexes: [/hi,\s+/i],
  },
  {
    name: "dashboard-profile",
    path: "/dashboard/profile",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("My Profile")'],
    bodyIncludes: ["My Profile"],
  },
  {
    name: "dashboard-listings",
    path: "/dashboard/listings",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Your Content"],
  },
  {
    name: "dashboard-businesses",
    path: "/dashboard/businesses",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Mzansi Business"],
  },
  {
    name: "dashboard-promotions",
    path: "/dashboard/promotions",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Tourism & Events"],
  },
  {
    name: "dashboard-leads",
    path: "/dashboard/leads",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Leads"],
  },
  {
    name: "dashboard-metrics",
    path: "/dashboard/metrics",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Metrics"],
  },
  {
    name: "dashboard-storefronts",
    path: "/dashboard/storefronts",
    scope: "user",
    readySelectors: ["main"],
  },
  {
    name: "dashboard-settings",
    path: "/dashboard/settings",
    scope: "user",
    readySelectors: ["main"],
  },
  {
    name: "dashboard-communication",
    path: "/dashboard/communication",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Communication"],
  },
  {
    name: "dashboard-business-profiles",
    path: "/dashboard/business-profiles",
    scope: "user",
    readySelectors: ["main"],
  },
  {
    name: "dashboard-tourism-events",
    path: "/dashboard/tourism-events",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Tourism & Events"],
  },
  {
    name: "dashboard-complete-profile",
    path: "/dashboard/complete-profile",
    scope: "user",
    readySelectors: ["main"],
  },
  {
    name: "post-create",
    path: "/post/create",
    scope: "user",
    readySelectors: ["main"],
    titleIncludes: ["Create a Post"],
  },
  {
    name: "post-create-listing",
    path: "/post/create-listing",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "post-create-business",
    path: "/post/create-business",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "post-create-promotion",
    path: "/post/create-promotion",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "post-create-tourism",
    path: "/post/create-tourism",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "post-create-business-ad",
    path: "/post/create-business-ad",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "post-create-mall-shop",
    path: "/post/create-mall-shop",
    scope: "user",
    readySelectors: ["main", "form"],
  },
  {
    name: "verification",
    path: "/verification",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("Get Verified")'],
    bodyIncludes: ["Get Verified", "Verification progress"],
  },
  {
    name: "billing",
    path: "/billing",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("Choose your visibility plan")'],
    titleIncludes: ["Pricing"],
    bodyIncludes: ["Choose your visibility plan"],
  },
  {
    name: "billing-success",
    path: "/billing/success",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("Payment")'],
    titleIncludes: ["Payment Status"],
    bodyIncludesAny: [
      "Payment Confirmed",
      "Payment Pending",
      "Payment Failed",
      "Payment Expired",
      "Payment Not Found",
    ],
  },
  {
    name: "billing-cancel",
    path: "/billing/cancel",
    scope: "user",
    readySelectors: ["main", 'h1:has-text("Payment")'],
    titleIncludes: ["Payment Status"],
    bodyIncludesAny: [
      "Payment complete",
      "Payment still processing",
      "Payment not completed",
      "Payment expired",
      "Payment not found",
    ],
  },
  {
    name: "dsar",
    path: "/dsar",
    scope: "user",
    readySelectors: ["main"],
  },
];

const ADMIN_ROUTE_TARGETS: RouteTarget[] = [
  {
    name: "admin-home",
    path: "/admin",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Admin Dashboard"],
    bodyIncludes: ["Admin"],
  },
  {
    name: "admin-verification",
    path: "/admin/verification",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Verification Queue"],
  },
  {
    name: "admin-evidence-desk",
    path: "/admin/verification/evidence",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Evidence Desk"],
  },
  {
    name: "admin-reports",
    path: "/admin/reports",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Reports"],
  },
  {
    name: "admin-mzansi-market",
    path: "/admin/mzansi-market",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Mzansi Market"],
  },
  {
    name: "admin-businesses",
    path: "/admin/businesses",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Mzansi Business"],
  },
  {
    name: "admin-promotions-events",
    path: "/admin/promotions-events",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Tourism & Events"],
  },
  {
    name: "admin-moderation",
    path: "/admin/moderation",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Moderation Queue"],
  },
  {
    name: "admin-dsar",
    path: "/admin/dsar",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Data Requests"],
  },
  {
    name: "admin-feature-flags",
    path: "/admin/feature-flags",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Feature Flags"],
  },
  {
    name: "admin-audit-log",
    path: "/admin/audit-log",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Audit Log"],
  },
  {
    name: "admin-governance-escalations",
    path: "/admin/governance/escalations",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Escalations"],
  },
  {
    name: "admin-governance-appeals",
    path: "/admin/governance/appeals",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Appeals"],
  },
  {
    name: "admin-governance-enforcement",
    path: "/admin/governance/enforcement",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Enforcement Review"],
  },
  {
    name: "admin-governance-oversight",
    path: "/admin/governance/oversight",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Oversight Hub"],
  },
  {
    name: "admin-governance-roles",
    path: "/admin/governance/roles",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Role Management"],
  },
  {
    name: "admin-intelligence-users",
    path: "/admin/intelligence/users",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Users & Growth"],
  },
  {
    name: "admin-intelligence-verification",
    path: "/admin/intelligence/verification",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Verification Metrics"],
  },
  {
    name: "admin-intelligence-marketplace",
    path: "/admin/intelligence/marketplace",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Marketplace Health"],
  },
  {
    name: "admin-intelligence-trends",
    path: "/admin/intelligence/trends",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Trend Analysis"],
  },
  {
    name: "admin-intelligence-revenue",
    path: "/admin/intelligence/revenue",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Revenue & Costs"],
  },
  {
    name: "admin-intelligence-operations",
    path: "/admin/intelligence/operations",
    scope: "admin",
    readySelectors: ["main"],
    titleIncludes: ["Ops Summary"],
  },
];

const BOUNDARY_CHECKS: BoundaryCheck[] = [
  {
    name: "public-to-dashboard-redirect",
    path: "/dashboard",
    expectedUrlPattern: /\/login/i,
  },
  {
    name: "public-to-post-create-redirect",
    path: "/post/create",
    expectedUrlPattern: /\/login/i,
  },
  {
    name: "public-to-admin-redirect",
    path: "/admin",
    expectedUrlPattern: /\/(login|admin|dashboard|banned)/i,
  },
  {
    name: "public-to-billing-success-redirect",
    path: "/billing/success",
    expectedUrlPattern: /\/login\?returnUrl=%2Fbilling%2Fsuccess/i,
  },
  {
    name: "public-to-billing-cancel-redirect",
    path: "/billing/cancel",
    expectedUrlPattern: /\/login\?returnUrl=%2Fbilling%2Fcancel/i,
  },
];

const DYNAMIC_DISCOVERY_TARGETS: DynamicDiscovery[] = [
  {
    name: "listing-detail",
    sourcePath: "/mzansi-market",
    match: /^\/listing\/[^/?#]+$/i,
    titleIncludes: ["VerifyMzansi"],
  },
  {
    name: "business-detail",
    sourcePath: "/mzansi-business",
    match: /^\/mzansi-business\/[^/?#]+$/i,
  },
  {
    name: "tourism-event-detail",
    sourcePath: "/tourism-events",
    match: /^\/tourism-events\/[^/?#]+$/i,
  },
  {
    name: "promotion-detail",
    sourcePath: "/promotions",
    match: /^\/promotion\/[^/?#]+$/i,
  },
  {
    name: "mall-shop-detail",
    sourcePath: "/mzansi-business?type=mall_store",
    match: /^\/mall-shop\/[^/?#]+$/i,
  },
  {
    name: "business-ad-detail",
    sourcePath: "/mzansi-business",
    match: /^\/business-ad\/[^/?#]+$/i,
  },
];

function report(message: string) {
  process.stdout.write(`${message}\n`);
}

function parseScopes(value?: string): ExtraScope[] {
  const requested = (value || "public,boundary")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set<ExtraScope>(["public", "user", "admin", "boundary"]);
  const resolved = requested.filter((entry): entry is ExtraScope =>
    allowed.has(entry as ExtraScope)
  );

  if (resolved.length > 0) {
    return resolved;
  }

  return ["public", "boundary"];
}

function getStorageStateEnv(scope: SessionScope): string | undefined {
  switch (scope) {
    case "user":
      return process.env.LIVE_VERIFY_USER_STORAGE_STATE;
    case "admin":
      return process.env.LIVE_VERIFY_ADMIN_STORAGE_STATE;
    default:
      return undefined;
  }
}

function getCookiesEnv(scope: SessionScope): string | undefined {
  switch (scope) {
    case "user":
      return process.env.LIVE_VERIFY_USER_COOKIES_JSON;
    case "admin":
      return process.env.LIVE_VERIFY_ADMIN_COOKIES_JSON;
    default:
      return undefined;
  }
}

function getSessionAvailability(scope: SessionScope): SessionAvailability {
  if (scope === "public") {
    return { available: true };
  }

  if (getStorageStateEnv(scope) || getCookiesEnv(scope)) {
    return { available: true };
  }

  return {
    available: false,
    reason: `Provide ${scope === "user" ? "LIVE_VERIFY_USER" : "LIVE_VERIFY_ADMIN"}_STORAGE_STATE or ${scope === "user" ? "LIVE_VERIFY_USER" : "LIVE_VERIFY_ADMIN"}_COOKIES_JSON`,
  };
}

async function readCookiesFromFile(filePath: string): Promise<Cookie[]> {
  const contents = await readFile(filePath, "utf8");
  const parsed = JSON.parse(contents) as Array<Record<string, unknown>>;
  const { hostname } = new URL(baseUrl);

  return parsed.map((entry) => ({
    name: String(entry.name || ""),
    value: String(entry.value || ""),
    domain: typeof entry.domain === "string" && entry.domain ? entry.domain : hostname,
    path: typeof entry.path === "string" && entry.path ? entry.path : "/",
    secure: typeof entry.secure === "boolean" ? entry.secure : true,
    httpOnly: typeof entry.httpOnly === "boolean" ? entry.httpOnly : false,
    sameSite:
      entry.sameSite === "Strict" || entry.sameSite === "Lax" || entry.sameSite === "None"
        ? entry.sameSite
        : "Lax",
    expires: typeof entry.expires === "number" ? entry.expires : -1,
  }));
}

function getContextOptions(device: DeviceProfile): BrowserContextOptions {
  if (device === "mobile") {
    return { ...devices["Pixel 7"] };
  }

  return { ...devices["Desktop Chrome"] };
}

async function openContext(
  browser: Browser,
  scope: SessionScope,
  device: DeviceProfile
): Promise<BrowserContext> {
  const storageState = getStorageStateEnv(scope);
  const context = await browser.newContext({
    ...getContextOptions(device),
    ...(storageState ? { storageState } : {}),
  });

  const cookiesPath = getCookiesEnv(scope);
  if (cookiesPath) {
    const cookies = await readCookiesFromFile(cookiesPath);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
  }

  return context;
}

function attachRuntimeCapture(page: Page): ConsoleCapture {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedApiResponses: string[] = [];
  const non2xxRequests: Array<{
    method: string;
    url: string;
    status?: number;
    resourceType: string;
  }> = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) {
      return;
    }

    const request = response.request();
    const pathname = safePathname(response.url());
    if (pathname.startsWith("/api/") && status >= 500) {
      failedApiResponses.push(`${status} ${pathname}`);
    }

    non2xxRequests.push({
      method: request.method(),
      url: response.url(),
      status,
      resourceType: request.resourceType(),
    });
  });

  return { consoleErrors, pageErrors, failedApiResponses, non2xxRequests };
}

function safePathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

function isKnownConsoleNoise(message: string): boolean {
  const value = message.toLowerCase();
  if (value.includes("permissions policy violation: xr-spatial-tracking")) {
    return true;
  }
  if (value.includes("font-size:0;color:transparent nan")) {
    return true;
  }
  if (value.includes("status of 401") && value.includes("failed to load resource")) {
    return true;
  }
  return false;
}

function isActionableRequest(url: string, status?: number, resourceType?: string): boolean {
  if (!status || status < 400) {
    return false;
  }

  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("challenges.cloudflare.com/cdn-cgi/challenge-platform") && status === 401) {
    return false;
  }

  if (lowerUrl.includes("/_next/static/") && resourceType === "script") {
    return true;
  }

  if (lowerUrl.includes("/cdn-cgi/image/") || lowerUrl.includes("/api/media/serve/")) {
    return true;
  }

  return false;
}

function collectActionableRuntimeIssues(runtime: ConsoleCapture): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];

  for (const message of runtime.consoleErrors) {
    if (!isKnownConsoleNoise(message)) {
      issues.push({ kind: "console", detail: message });
    }
  }

  for (const error of runtime.pageErrors) {
    const lowerError = error.toLowerCase();
    if (lowerError.includes("react error #418") || lowerError.includes("hydration")) {
      issues.push({ kind: "pageerror", detail: error });
    }
  }

  for (const response of runtime.non2xxRequests) {
    if (isActionableRequest(response.url, response.status, response.resourceType)) {
      issues.push({
        kind: "request",
        detail: `${response.status} ${response.resourceType} ${response.url}`,
      });
    }
  }

  for (const apiError of runtime.failedApiResponses) {
    issues.push({ kind: "api", detail: apiError });
  }

  return issues;
}

async function assertAuthUi(page: Page) {
  const consoleErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const targetWindow = window as unknown as { __vmzCspViolations?: string[] };
      targetWindow.__vmzCspViolations = targetWindow.__vmzCspViolations || [];
      targetWindow.__vmzCspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });

  const unavailableCopy = page.getByText(/security verification is temporarily unavailable/i);
  const failedCopy = page.getByText(/security check failed/i);
  const iframeLocator = page.locator("iframe");
  const iframeCount = await iframeLocator.count();
  const unavailableCount = await unavailableCopy.count();

  if (requireRealTurnstile && iframeCount === 0 && unavailableCount === 0) {
    await Promise.race([
      iframeLocator
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

    const iframeCountAfter = await iframeLocator.count();
    const unavailableAfter = await unavailableCopy.count();
    const failedAfter = await failedCopy.count();

    if (iframeCountAfter === 0 && unavailableAfter === 0 && failedAfter === 0) {
      const diagnostics = await page.evaluate(() => {
        const el = document.getElementById("vmz-public-config");
        const turnstileSiteKey = el instanceof HTMLElement ? el.dataset.turnstileSiteKey || "" : "";
        const scriptTags = Array.from(document.querySelectorAll("script[src]")).map(
          (script) => (script as HTMLScriptElement).src
        );
        const turnstileScripts = scriptTags.filter((script) =>
          script.includes("challenges.cloudflare")
        );
        const targetWindow = window as unknown as { __vmzCspViolations?: string[] };
        const cspViolations = targetWindow.__vmzCspViolations || [];
        const iframes = Array.from(document.querySelectorAll("iframe")).map((frame) => frame.src);
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
    .waitFor({
      state: "visible",
      timeout: readyTimeoutMs,
    });
}

async function assertMobileFooter(page: Page) {
  const marketplaceTabs = page.getByRole("navigation", { name: "Marketplace areas" });
  const marketTab = marketplaceTabs.getByRole("link", { name: "Mzansi Market" });
  const businessTab = marketplaceTabs.getByRole("link", { name: "Mzansi Business" });
  const promotionsTab = marketplaceTabs.getByRole("link", { name: "Tourism & Events" });

  await marketTab.waitFor({ state: "visible", timeout: readyTimeoutMs });
  await businessTab.waitFor({ state: "visible", timeout: readyTimeoutMs });
  await promotionsTab.waitFor({ state: "visible", timeout: readyTimeoutMs });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(250);

  const footerLink = page.getByRole("link", { name: "Privacy Policy" });
  const bottomNav = page.getByRole("navigation", { name: "Main" });

  await footerLink.waitFor({ state: "visible", timeout: readyTimeoutMs });
  await bottomNav.waitFor({ state: "visible", timeout: readyTimeoutMs });

  const footerBottom = await footerLink.evaluate(
    (element) => element.getBoundingClientRect().bottom
  );
  const navTop = await bottomNav.evaluate((element) => element.getBoundingClientRect().top);

  if (footerBottom > navTop) {
    throw new Error("Footer content overlaps the fixed bottom navigation on mobile");
  }
}

async function waitForReadySelector(page: Page, target: RouteTarget): Promise<string | undefined> {
  const selectors = target.readySelectors?.length ? target.readySelectors : ["main"];

  for (const selector of selectors) {
    try {
      await page.locator(selector).first().waitFor({ state: "visible", timeout: readyTimeoutMs });
      return selector;
    } catch {
      // Try the next selector.
    }
  }

  throw new Error(`No ready selector became visible for ${target.name}: ${selectors.join(", ")}`);
}

async function assertPageContract(page: Page, target: RouteTarget) {
  const finalUrl = page.url();
  if (target.expectedUrlPattern && !target.expectedUrlPattern.test(finalUrl)) {
    throw new Error(`Final URL ${finalUrl} did not match ${target.expectedUrlPattern}`);
  }

  const title = await page.title();
  if (target.titleIncludes?.length) {
    for (const expected of target.titleIncludes) {
      if (!title.toLowerCase().includes(expected.toLowerCase())) {
        throw new Error(
          `Document title ${JSON.stringify(title)} did not include ${JSON.stringify(expected)}`
        );
      }
    }
  }

  const bodyText = (await page.locator("body").innerText()).toLowerCase();

  if (target.bodyIncludes?.length) {
    for (const expected of target.bodyIncludes) {
      if (!bodyText.includes(expected.toLowerCase())) {
        throw new Error(`Body text did not include ${JSON.stringify(expected)}`);
      }
    }
  }

  if (target.bodyIncludesAny?.length) {
    const matched = target.bodyIncludesAny.some((expected) =>
      bodyText.includes(expected.toLowerCase())
    );
    if (!matched) {
      throw new Error(`Body text did not include any of: ${target.bodyIncludesAny.join(", ")}`);
    }
  }

  if (target.bodyRegexes?.length) {
    for (const expected of target.bodyRegexes) {
      if (!expected.test(bodyText)) {
        throw new Error(`Body text did not match ${expected}`);
      }
    }
  }

  if (target.forbiddenBodyIncludes?.length) {
    for (const forbidden of target.forbiddenBodyIncludes) {
      if (bodyText.includes(forbidden.toLowerCase())) {
        throw new Error(`Body text unexpectedly included ${JSON.stringify(forbidden)}`);
      }
    }
  }

  for (const check of target.customChecks || []) {
    if (check === "auth-ui") {
      await assertAuthUi(page);
    }
    if (check === "mobile-footer") {
      await assertMobileFooter(page);
    }
  }
}

async function captureScreenshot(page: Page, name: string) {
  await mkdir(artifactsDir, { recursive: true });
  await page.screenshot({
    path: path.join(artifactsDir, `${name}.png`),
    fullPage: true,
  });
}

async function verifyRoute(browser: Browser, target: RouteTarget): Promise<RouteResult> {
  const availability = getSessionAvailability(target.scope);
  const device = target.device || "desktop";

  if (!availability.available) {
    return {
      name: target.name,
      scope: target.scope,
      path: target.path,
      status: "skip",
      device,
      notes: [availability.reason || "Session unavailable"],
      consoleErrors: [],
      pageErrors: [],
      failedApiResponses: [],
      non2xxRequests: [],
    };
  }

  const context = await openContext(browser, target.scope, device);
  const page = await context.newPage();
  const runtime = attachRuntimeCapture(page);

  try {
    const response = await page.goto(new URL(target.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    if (!response) {
      throw new Error(`No response for ${target.path}`);
    }

    if (response.status() >= 400) {
      throw new Error(`Unexpected document status ${response.status()} for ${target.path}`);
    }

    const readySelector = await waitForReadySelector(page, target);
    await page.waitForTimeout(loadSettleMs);
    await assertPageContract(page, target);

    const runtimeIssues = collectActionableRuntimeIssues(runtime);
    if (runtimeIssues.length > 0) {
      throw new Error(runtimeIssues.map((issue) => `${issue.kind}: ${issue.detail}`).join(" | "));
    }

    const title = await page.title();
    const notes: string[] = [];
    if (runtime.non2xxRequests.length > 0) {
      notes.push(`Observed ${runtime.non2xxRequests.length} non-2xx subrequests`);
    }
    if (runtime.failedApiResponses.length > 0) {
      notes.push(`Observed ${runtime.failedApiResponses.length} failing API responses`);
    }

    return {
      name: target.name,
      scope: target.scope,
      path: target.path,
      status: "pass",
      device,
      finalUrl: page.url(),
      documentStatus: response.status(),
      title,
      readySelector,
      notes,
      consoleErrors: runtime.consoleErrors,
      pageErrors: runtime.pageErrors,
      failedApiResponses: runtime.failedApiResponses,
      non2xxRequests: runtime.non2xxRequests,
    };
  } catch (error) {
    await captureScreenshot(page, target.name);
    return {
      name: target.name,
      scope: target.scope,
      path: target.path,
      status: "fail",
      device,
      finalUrl: page.url(),
      title: await page.title().catch(() => undefined),
      notes: [error instanceof Error ? error.message : String(error)],
      consoleErrors: runtime.consoleErrors,
      pageErrors: runtime.pageErrors,
      failedApiResponses: runtime.failedApiResponses,
      non2xxRequests: runtime.non2xxRequests,
    };
  } finally {
    await context.close();
  }
}

async function verifyBoundary(browser: Browser, check: BoundaryCheck): Promise<RouteResult> {
  const context = await openContext(browser, "public", "desktop");
  const page = await context.newPage();
  const runtime = attachRuntimeCapture(page);

  try {
    const response = await page.goto(new URL(check.path, baseUrl).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    if (!response) {
      throw new Error(`No response for ${check.path}`);
    }

    await page.waitForTimeout(loadSettleMs);
    if (!check.expectedUrlPattern.test(page.url())) {
      throw new Error(`Final URL ${page.url()} did not match ${check.expectedUrlPattern}`);
    }

    return {
      name: check.name,
      scope: "boundary",
      path: check.path,
      status: "pass",
      device: "desktop",
      finalUrl: page.url(),
      documentStatus: response.status(),
      title: await page.title(),
      notes: [],
      consoleErrors: runtime.consoleErrors,
      pageErrors: runtime.pageErrors,
      failedApiResponses: runtime.failedApiResponses,
      non2xxRequests: runtime.non2xxRequests,
    };
  } catch (error) {
    await captureScreenshot(page, check.name);
    return {
      name: check.name,
      scope: "boundary",
      path: check.path,
      status: "fail",
      device: "desktop",
      finalUrl: page.url(),
      title: await page.title().catch(() => undefined),
      notes: [error instanceof Error ? error.message : String(error)],
      consoleErrors: runtime.consoleErrors,
      pageErrors: runtime.pageErrors,
      failedApiResponses: runtime.failedApiResponses,
      non2xxRequests: runtime.non2xxRequests,
    };
  } finally {
    await context.close();
  }
}

async function discoverDynamicTargets(browser: Browser): Promise<RouteTarget[]> {
  if (rawArgs.has("--skip-dynamic-discovery")) {
    return [];
  }

  const context = await openContext(browser, "public", "desktop");
  const page = await context.newPage();
  const discovered: RouteTarget[] = [];
  const seenPaths = new Set<string>();
  const baseOrigin = new URL(baseUrl).origin;

  try {
    for (const discovery of DYNAMIC_DISCOVERY_TARGETS) {
      await page.goto(new URL(discovery.sourcePath, baseUrl).toString(), {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(loadSettleMs);

      const hrefs = await page
        .locator("a[href]")
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute("href") || "").filter(Boolean)
        );

      const match = hrefs
        .map((href) => {
          try {
            const resolved = new URL(href, baseOrigin);
            return `${resolved.pathname}${resolved.search}`;
          } catch {
            return href;
          }
        })
        .find((href) => discovery.match.test(href));

      if (!match || seenPaths.has(match)) {
        continue;
      }

      seenPaths.add(match);
      discovered.push({
        name: `${discovery.name}-sample`,
        path: match,
        scope: "public",
        readySelectors: ["main", "main h1", "main article", "main section"],
        titleIncludes: discovery.titleIncludes,
        forbiddenBodyIncludes: ["not found", "page not found"],
      });
    }
  } finally {
    await context.close();
  }

  return discovered;
}

function filterTargetsByScopes(scopes: ExtraScope[], dynamicTargets: RouteTarget[]): RouteTarget[] {
  const targets: RouteTarget[] = [];

  if (scopes.includes("public")) {
    targets.push(...PUBLIC_ROUTE_TARGETS, ...dynamicTargets);
  }
  if (scopes.includes("user")) {
    targets.push(...USER_ROUTE_TARGETS);
  }
  if (scopes.includes("admin")) {
    targets.push(...ADMIN_ROUTE_TARGETS);
  }

  return targets;
}

async function main() {
  const scopes = parseScopes(process.env.LIVE_VERIFY_SCOPES);
  const browser = await chromium.launch({ headless: !rawArgs.has("--headed") });

  try {
    report(`Verifying live pages at ${baseUrl}`);
    report(`Scopes: ${scopes.join(", ")}`);

    const dynamicTargets = scopes.includes("public") ? await discoverDynamicTargets(browser) : [];
    if (dynamicTargets.length > 0) {
      report(`Discovered ${dynamicTargets.length} live dynamic detail sample(s).`);
    }

    const routeTargets = filterTargetsByScopes(scopes, dynamicTargets);
    const results: RouteResult[] = [];

    for (const target of routeTargets) {
      const result = await verifyRoute(browser, target);
      results.push(result);
      report(
        `[${result.status.toUpperCase()}] ${target.name} -> ${result.finalUrl || target.path}${
          result.notes.length > 0 ? ` (${result.notes[0]})` : ""
        }`
      );
    }

    if (scopes.includes("boundary")) {
      for (const check of BOUNDARY_CHECKS) {
        const result = await verifyBoundary(browser, check);
        results.push(result);
        report(
          `[${result.status.toUpperCase()}] ${check.name} -> ${result.finalUrl || check.path}${
            result.notes.length > 0 ? ` (${result.notes[0]})` : ""
          }`
        );
      }
    }

    const summary = {
      baseUrl,
      verifiedAt: new Date().toISOString(),
      scopes,
      totals: {
        pass: results.filter((result) => result.status === "pass").length,
        fail: results.filter((result) => result.status === "fail").length,
        skip: results.filter((result) => result.status === "skip").length,
      },
      results,
    };

    await mkdir(artifactsDir, { recursive: true });
    const outputPath = path.join(artifactsDir, `live-page-verify-${Date.now()}.json`);
    await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");
    report(`Live page verification report written to ${outputPath}`);

    if (summary.totals.fail > 0) {
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Live page verification failed:", error);
  process.exit(1);
});
