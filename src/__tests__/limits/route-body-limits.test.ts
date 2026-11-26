/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as HiddenFeatures from "@/lib/hidden-features";
import type * as RequestBody from "@/lib/utils/request-body";
import type * as RateLimit from "@/lib/utils/rate-limit";
import type * as RecoveryBinding from "@/lib/foundation/recovery-binding";
import type * as AccountProfile from "@/lib/foundation/account-profile";
import type * as PostingTerms from "@/lib/foundation/posting-terms";
import { POST as accountDelete } from "@/app/api/account/delete/route";
import { POST as caseMessage } from "@/app/api/admin/business-verification/[id]/message/route";
import { POST as caseVisit } from "@/app/api/admin/business-verification/[id]/visit/route";
import { POST as adminCommercial } from "@/app/api/admin/commercial/route";
import { POST as governanceAppeal } from "@/app/api/admin/governance/appeal/route";
import { POST as ozowRefunds } from "@/app/api/admin/payments/ozow-refunds/route";
import { POST as analyticsEvents } from "@/app/api/analytics/events/route";
import { POST as appeals } from "@/app/api/appeals/route";
import { POST as billingInvoices } from "@/app/api/billing/invoices/route";
import { POST as packageAddInvoice } from "@/app/api/billing/package-add-invoice/route";
import { POST as packageInvoice } from "@/app/api/billing/package-invoice/route";
import { POST as payInvoice } from "@/app/api/pay-invoice/route";
import { POST as cspReport } from "@/app/api/csp-report/route";
import { POST as dsarSubmit } from "@/app/api/dsar/submit/route";
import { POST as engagementLike } from "@/app/api/engagement/like/route";
import { POST as engagementView } from "@/app/api/engagement/view/route";
import { POST as engagementViewer } from "@/app/api/engagement/viewer/route";
import { handleOrganisationRoute } from "@/app/api/foundation/_lib/organisation-route";
import { handleFoundationEmailChange } from "@/app/api/foundation/auth/_lib/email-change";
import { handleFoundationPasswordChange } from "@/app/api/foundation/auth/_lib/password-change";
import { handleFoundationRecoveryCompletion } from "@/app/api/foundation/auth/_lib/recovery-complete";
import { POST as signIn } from "@/app/api/foundation/auth/login/route";
import { POST as recoveryRequest } from "@/app/api/foundation/auth/recovery/request/route";
import { POST as foundationContact } from "@/app/api/foundation/contact/route";
import { POST as foundationEnquiries } from "@/app/api/foundation/enquiries/route";
import { POST as invitePreview } from "@/app/api/foundation/organisations/invites/preview/route";
import { POST as postingTerms } from "@/app/api/foundation/posting-terms/route";
import { POST as foundationReports } from "@/app/api/foundation/reports/route";
import { POST as verificationReview } from "@/app/api/foundation/verification/review/route";
import { POST as bindingsVerify } from "@/app/api/internal/bindings/verify/route";
import { handleFoundationBillingRoute } from "@/lib/foundation/billing-route";
import { handleNativeCipcStaffAction } from "@/lib/foundation/cipc-commands";
import { postFoundationContactEnquiry } from "@/lib/foundation/contact-enquiry-route";
import { revealFoundationContact } from "@/lib/foundation/contact-reveal-route";
import { handleFoundationEvidenceRead } from "@/lib/foundation/evidence-route";
import { handlePrivacyStaffRoute } from "@/lib/foundation/privacy-requests";
import { handleRestoredPostMutation } from "@/lib/foundation/restored-post-route";
import { createLogger } from "@/lib/utils/logger";

/**
 * Request body caps (`maxBytes`) from docs/testing/limits-register.json, each
 * checked through its real route or route handler: a JSON body of exactly
 * the registered number of bytes is read, and one byte more is refused
 * (status 400 or above) before anything reaches the database. The requests
 * carry no Content-Length, so the cap is enforced on the bytes streamed, not
 * on a declared length.
 *
 * Only what stands before the body read is replaced: the session (a signed-in
 * caller), the rate limiter (not limited), feature switches (on), and the few
 * reads some routes make first. Origin and CSRF checks are real. Every
 * database call (the caller's api, the network, the posting-terms write) is
 * recorded next to each body read, so the test can tell that nothing ran
 * after a refused read.
 */

const events = vi.hoisted(() => [] as string[]);
const caller = vi.hoisted(() => ({ recovery: false }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/utils/request-body", async (importOriginal) => {
  const actual = await importOriginal<typeof RequestBody>();
  return {
    ...actual,
    readBoundedRequestText: async (
      request: Parameters<typeof actual.readBoundedRequestText>[0],
      maxBytes: number
    ) => {
      try {
        const text = await actual.readBoundedRequestText(request, maxBytes);
        events.push(`read within ${maxBytes}`);
        return text;
      } catch (error) {
        events.push(
          error instanceof actual.RequestBodyTooLargeError
            ? `refused over ${maxBytes}`
            : `unreadable at ${maxBytes}`
        );
        throw error;
      }
    },
  };
});
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: () => ({
    url: "https://db.example",
    publishableKey: "publishable",
    projectRef: "limitsprobe",
  }),
}));
vi.mock("@/lib/foundation/request-route", () => {
  // Any method of the caller's api is a database call: recorded, answered empty.
  const api = new Proxy(
    {},
    {
      get: (_target, name) =>
        name === "then" || typeof name === "symbol"
          ? undefined
          : (..._args: unknown[]) => {
              events.push(`database ${name}`);
              return Promise.resolve({ data: null, error: null });
            },
    }
  );
  const account = "22222222-2222-4222-8222-222222222222";
  const verified = () => ({
    api,
    accountId: account,
    sessionId: account,
    signedInAt: Math.floor(Date.now() / 1000) - 60,
    user: { email: "member@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" },
    openedByRecovery: false,
    recovery: caller.recovery ? { sessionId: account } : null,
    resetPassword: caller.recovery,
  });
  return {
    createFoundationRouteContext: () => ({
      authenticate: async () => api,
      authenticateCaller: async () => verified(),
      respond: async (response: Response) => response,
    }),
  };
});
vi.mock("@/lib/utils/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof RateLimit>()),
  checkRateLimit: async () => ({ limited: false }),
  checkLocalRateLimit: () => ({ limited: false }),
  getClientRateLimitIdentity: () => ({ key: "client" }),
}));
vi.mock("@/lib/hidden-features", async (importOriginal) => ({
  ...(await importOriginal<typeof HiddenFeatures>()),
  SHOW_ENGAGEMENT_TOTALS: true,
  SHOW_ACCOUNT_DELETION: true,
}));
vi.mock("@opennextjs/cloudflare", () => {
  const context = { env: { HEALTH_DIAGNOSTIC_TOKEN: "d".repeat(32) } };
  return {
    getCloudflareContext: (options?: { async?: boolean }) =>
      options?.async ? Promise.resolve(context) : context,
  };
});
// Reads made before the body by the password change, the recovery reset and
// the posting terms routes.
vi.mock("@/lib/foundation/account-context", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readFoundationAccountContext: async () => ({
    account_id: "22222222-2222-4222-8222-222222222222",
    staff: null,
  }),
}));
vi.mock("@/lib/foundation/recovery-binding", async (importOriginal) => ({
  ...(await importOriginal<typeof RecoveryBinding>()),
  readRecoveryBinding: () => ({
    session: "22222222-2222-4222-8222-222222222222",
    account: "22222222-2222-4222-8222-222222222222",
  }),
  recoveryPageMatches: () => true,
}));
vi.mock("@/lib/foundation/account-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof AccountProfile>()),
  foundationAccountProfileSchema: { safeParse: () => ({ success: true }) },
}));
vi.mock("@/lib/foundation/posting-terms", async (importOriginal) => ({
  ...(await importOriginal<typeof PostingTerms>()),
  readFoundationOwnerPostingTerms: async () => ({}),
  acceptFoundationPostingTerms: async () => {
    events.push("database accept_posting_terms");
    return {};
  },
}));
vi.mock("@/lib/legal/published-posting-terms", () => ({
  assertPublishedPostingTerms: () => undefined,
}));

const ORIGIN = "https://verifymzansi.com";
const CSRF = "c".repeat(64);
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const CASE = { params: Promise.resolve({ id: CASE_ID }) };
const anything = z.any() as unknown as Parameters<typeof handleNativeCipcStaffAction>[3];
const noCommand = async () => {
  events.push("database command");
  return {};
};

type Route = (request: NextRequest) => Promise<Response> | Response;
/** [register id, registered cap in bytes, the route] */
const ROUTES: Array<[string, number, Route]> = [
  ["LIM-APP-account-delete", 1024, accountDelete],
  ["LIM-APP-admin-business-verification-id-message", 13500, (r) => caseMessage(r, CASE)],
  ["LIM-APP-admin-business-verification-id-visit", 10000, (r) => caseVisit(r, CASE)],
  ["LIM-APP-admin-commercial", 16000, adminCommercial],
  ["LIM-APP-admin-governance-appeal", 13500, governanceAppeal],
  ["LIM-APP-admin-payments-ozow-refunds", 4000, ozowRefunds],
  ["LIM-APP-analytics-events", 16384, analyticsEvents],
  ["LIM-APP-appeals", 13000, appeals],
  ["LIM-APP-billing-invoices", 4096, billingInvoices],
  ["LIM-APP-billing-package-add-invoice", 4096, packageAddInvoice],
  ["LIM-APP-billing-package-invoice", 4096, packageInvoice],
  ["LIM-APP-pay-invoice", 4096, payInvoice],
  ["LIM-APP-csp-report-body", 10240, cspReport],
  ["LIM-APP-dsar-submit", 15000, dsarSubmit],
  ["LIM-APP-engagement-like", 2048, engagementLike],
  ["LIM-APP-engagement-view", 8192, engagementView],
  ["LIM-APP-engagement-viewer", 8192, engagementViewer],
  [
    "LIM-APP-foundation-_lib-organisation-route",
    32768,
    (r) => handleOrganisationRoute(r, "organisation:manage", true, noCommand, true),
  ],
  [
    "LIM-APP-foundation-_lib-organisation-route",
    8192,
    (r) => handleOrganisationRoute(r, "organisation:apply", true, noCommand),
  ],
  ["LIM-APP-foundation-auth-_lib-email-change", 4096, handleFoundationEmailChange],
  ["LIM-APP-foundation-auth-_lib-password-change", 4096, handleFoundationPasswordChange],
  [
    "LIM-APP-foundation-auth-_lib-recovery-complete",
    4096,
    (r) => {
      caller.recovery = true;
      return handleFoundationRecoveryCompletion(r, true);
    },
  ],
  ["LIM-APP-foundation-auth-attempt-route", 4096, signIn],
  ["LIM-APP-foundation-auth-recovery-request", 4096, recoveryRequest],
  [
    "LIM-APP-foundation-billing-route",
    4096,
    (r) => handleFoundationBillingRoute(r, "cancel-pending"),
  ],
  [
    "LIM-APP-foundation-cipc-commands",
    10000,
    (r) => handleNativeCipcStaffAction(r, CASE_ID, "office", anything),
  ],
  ["LIM-APP-foundation-contact", 8192, foundationContact],
  ["LIM-APP-foundation-contact-enquiry-route", 8192, postFoundationContactEnquiry],
  ["LIM-APP-foundation-contact-reveal-route", 8192, revealFoundationContact],
  ["LIM-APP-foundation-enquiries", 8192, foundationEnquiries],
  ["LIM-APP-foundation-evidence-route", 4096, (r) => handleFoundationEvidenceRead(r)],
  ["LIM-APP-foundation-organisations-invites-preview", 1024, invitePreview],
  ["LIM-APP-foundation-posting-terms", 4096, postingTerms],
  [
    "LIM-APP-foundation-privacy-requests",
    27000,
    (r) => handlePrivacyStaffRoute(r, createLogger("LimitsProbe"), "decide", noCommand),
  ],
  ["LIM-APP-foundation-reports", 12288, foundationReports],
  [
    "LIM-APP-foundation-restored-post-route",
    131072,
    (r) => handleRestoredPostMutation(r, "listings"),
  ],
  ["LIM-APP-foundation-verification-review", 4096, verificationReview],
  ["LIM-APP-internal-bindings-verify", 8192, bindingsVerify],
];

/** A same-origin POST with valid CSRF whose JSON body is exactly `bytes` long. */
function post(bytes: number) {
  const body = `{"pad":"${"x".repeat(bytes - 10)}"}`;
  expect(new TextEncoder().encode(body).byteLength).toBe(bytes);
  return new NextRequest(`${ORIGIN}/api/limits-probe`, {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      referer: `${ORIGIN}/reset-password`,
      "content-type": "application/json",
      cookie: `vm_csrf=${CSRF}`,
      "x-csrf-token": CSRF,
      authorization: `Bearer ${"d".repeat(32)}`,
      "user-agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile",
    },
  });
}

beforeEach(() => {
  events.length = 0;
  caller.recovery = false;
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.stubEnv("FOUNDATION_PASSWORD_AUTH_MODE", "native-captcha");
  vi.stubEnv("FOUNDATION_AUTH_CALLBACK_ENABLED", "true");
  vi.stubEnv("FOUNDATION_RECOVERY_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      events.push("database fetch");
      return new Response(null, { status: 503 });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("limits register: request body caps", () => {
  it("has a row for every entry of docs/testing/limits-register.json that names this file, at its value", () => {
    const register = JSON.parse(
      readFileSync(join(process.cwd(), "docs/testing/limits-register.json"), "utf8")
    ) as { limits: Array<{ id: string; value: number | string; tests: Array<{ file?: string }> }> };
    const entries = register.limits.filter((entry) =>
      entry.tests.some((test) => test.file === "src/__tests__/limits/route-body-limits.test.ts")
    );
    expect(new Set(ROUTES.map(([id]) => id))).toEqual(new Set(entries.map((entry) => entry.id)));
    for (const [id, cap] of ROUTES) {
      const value = String(entries.find((entry) => entry.id === id)?.value);
      expect(value === String(cap) || value.split(/\D+/).includes(String(cap)), id).toBe(true);
    }
  });

  it.each(ROUTES)("%s: reads a %i-byte body and refuses one byte more", async (_id, cap, route) => {
    await route(post(cap));
    expect(events.filter((event) => !event.startsWith("database"))).toEqual([`read within ${cap}`]);

    events.length = 0;
    const refused = await route(post(cap + 1));
    expect(refused.status).toBeGreaterThanOrEqual(400);
    // The refusal is the last thing that happened: no database call after it.
    expect(events.at(-1)).toBe(`refused over ${cap}`);
    expect(events.filter((event) => !event.startsWith("database"))).toEqual([
      `refused over ${cap}`,
    ]);
  });
});
