/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/(auth)/auth/callback/route";
import { createClient as legacyClient } from "@/lib/supabase/server";
import { createAdminClient as legacyAdmin } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "landing-client" }),
}));

const target = "gntzjtuncsyefujajmjy";
const session = `sb-${target}-auth-token`;
const fetcher = vi.fn<typeof fetch>();
const PROFILE = "https://verifymzansi.com/dashboard/profile#account";
/** The existing failure page; the empty fragment drops the one Auth put on a refused link. */
const FAILED = "https://verifymzansi.com/login?error=auth_callback_failed#";
const BASE =
  "https://verifymzansi.com/auth/callback?next=%2Fdashboard%2Fprofile&backend=foundation&email_change=1";
/** Auth's own message after the first of the two links. */
const FIRST = "Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email";

beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    FOUNDATION_PASSWORD_AUTH_MODE: "native-captcha",
    FOUNDATION_AUTH_CALLBACK_ENABLED: "true",
    FOUNDATION_RECOVERY_ENABLED: "true",
    FOUNDATION_SUPABASE_URL: `https://${target}.supabase.co`,
    FOUNDATION_PROJECT_REF: target,
    FOUNDATION_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    NEXT_PUBLIC_APP_URL: "https://verifymzansi.com",
  }))
    vi.stubEnv(key, value);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Opens the landing as a browser that is signed in and holds a recovery binding. */
async function open(url: string) {
  const response = await GET(
    new NextRequest(url, {
      headers: {
        cookie: `${session}=base64-synthetic; __Host-vm_recovery_binding=synthetic; vm_csrf=${"c".repeat(64)}`,
      },
    })
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  // Nothing is exchanged, written or removed, and nobody is contacted.
  expect(response.cookies.getAll()).toEqual([]);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(legacyClient).not.toHaveBeenCalled();
  expect(legacyAdmin).not.toHaveBeenCalled();
  return response.headers.get("location");
}

describe("where an email change link lands", () => {
  it("shows the Account tab after the first of the two links", async () => {
    expect(await open(`${BASE}&message=${FIRST}`)).toBe(PROFILE);
  });

  it("shows the Account tab after the second link, without using its code", async () => {
    expect(await open(`${BASE}&code=synthetic-unusable-code`)).toBe(PROFILE);
  });

  it("does not depend on the order of the selectors", async () => {
    expect(
      await open(
        "https://verifymzansi.com/auth/callback?email_change=1&code=synthetic&backend=foundation"
      )
    ).toBe(PROFILE);
  });

  it("sends a used or expired link to the existing failure page", async () => {
    expect(
      await open(
        `${BASE}&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
      )
    ).toBe(FAILED);
  });

  it.each([
    ["no outcome", ""],
    ["both outcomes", `&code=synthetic&message=${FIRST}`],
    ["two codes", "&code=a&code=b"],
    ["two messages", `&message=${FIRST}&message=${FIRST}`],
    ["a recovery selector", "&code=synthetic&recovery=1"],
    ["a Google selector", "&code=synthetic&oauth=google"],
    ["a PKCE flow selector", "&code=synthetic&sb_flow_id=synthetic_flow"],
    ["a token hash", "&token_hash=synthetic&code=synthetic"],
    ["an error code alone", "&code=synthetic&error_code=otp_expired"],
    ["a second email change selector", "&code=synthetic&email_change=1"],
    ["a second backend selector", "&code=synthetic&backend=foundation"],
  ])("treats a link with %s as failed", async (_label, suffix) => {
    expect(await open(`${BASE}${suffix}`)).toBe(FAILED);
  });

  it.each([
    ["email_change=2", "&code=synthetic"],
    ["email_change=", "&code=synthetic"],
  ])("treats an unknown selector value (%s) as failed", async (selector, suffix) => {
    expect(
      await open(`https://verifymzansi.com/auth/callback?backend=foundation&${selector}${suffix}`)
    ).toBe(FAILED);
  });

  it.each([
    ["FOUNDATION_PASSWORD_AUTH_MODE", ""],
    ["FOUNDATION_AUTH_CALLBACK_ENABLED", "false"],
  ])("stays on the failure page while %s is %j", async (name, value) => {
    vi.stubEnv(name, value);
    expect(await open(`${BASE}&code=synthetic`)).toBe(FAILED);
  });

  it("stays on this site whatever the link's next address says", async () => {
    expect(
      await open(
        "https://verifymzansi.com/auth/callback?backend=foundation&email_change=1&next=https%3A%2F%2Fother.example%2F&code=synthetic"
      )
    ).toBe(PROFILE);
  });
});
