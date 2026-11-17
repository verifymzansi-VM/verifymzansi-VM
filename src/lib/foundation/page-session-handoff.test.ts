/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { FoundationAccountContext } from "./account-context";
import { digestFoundationToken } from "./page-session-digest";
import {
  dropIncomingFoundationPageSession,
  FOUNDATION_PAGE_SESSION_HEADER as HEADER,
  forwardFoundationPageSession,
  readFoundationPageSession,
  rememberFoundationPageSession,
} from "./page-session-handoff";

vi.mock("server-only", () => ({}));

const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const account = {
  version: 1,
  account_id: id,
  email: "member@example.invalid",
  phone: "+27820000000",
  profile: {
    display_name: "Thandiwe Ndlovu",
    public_name: "Thandiwe N.",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-11-01T00:00:00Z",
  },
  totp_enrolled: false,
  staff: null,
} as FoundationAccountContext;
const user = { id, aud: "authenticated", email: "member@example.invalid" } as User;
const page = (init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest("https://verifymzansi.com/dashboard", init);

/** Apply the request overrides exactly as Next's routing layer does. */
function downstream(request: NextRequest, response: NextResponse) {
  const headers = new Headers(request.headers);
  const overrides = response.headers.get("x-middleware-override-headers");
  if (overrides !== null) {
    const keys = overrides.split(",").filter(Boolean);
    for (const key of [...headers.keys()]) if (!keys.includes(key)) headers.delete(key);
    for (const key of keys) {
      const value = response.headers.get(`x-middleware-request-${key}`);
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }
  }
  return headers;
}

async function handedTo(request: NextRequest, token = "token-a") {
  await rememberFoundationPageSession(request, {
    tokenDigest: await digestFoundationToken(token),
    account,
    user,
  });
}

it("hands the gate's answer to the page only for the exact token it verified", async () => {
  const request = page();
  await handedTo(request);
  const value = downstream(
    request,
    forwardFoundationPageSession(
      request,
      NextResponse.next({ request: { headers: request.headers } })
    )
  ).get(HEADER);
  expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(await readFoundationPageSession(value, "token-a")).toEqual({ account, user });
  expect(await readFoundationPageSession(value, "token-b")).toBeNull();
});

it("never forwards a header the browser sent, whatever the response looks like", async () => {
  const forged = Buffer.from(
    JSON.stringify({
      v: 1,
      token: await digestFoundationToken("token-a"),
      account: {
        ...account,
        staff: { role: "admin", can_access: true, assigned_capabilities: [] },
      },
      user,
    })
  ).toString("base64url");
  const responses = (request: NextRequest) => [
    // A plain pass-through would otherwise forward the incoming headers as sent.
    NextResponse.next(),
    // An explicit list built from the incoming headers still names it.
    NextResponse.next({ request: { headers: new Headers(request.headers) } }),
    // A rewrite also renders, with the incoming headers unless told otherwise.
    NextResponse.rewrite(new URL("https://verifymzansi.com/other")),
  ];
  for (const method of ["GET", "POST"]) {
    for (const index of [0, 1, 2]) {
      const request = page({ method, headers: { [HEADER]: forged } });
      const response = forwardFoundationPageSession(request, responses(request)[index]);
      const headers = downstream(request, response);
      expect(headers.has(HEADER)).toBe(false);
      expect(response.headers.get(`x-middleware-request-${HEADER}`)).toBeNull();
      expect(response.headers.get("x-middleware-override-headers")).not.toContain(HEADER);
    }
  }
  const stripped = page({ headers: { [HEADER]: forged } });
  dropIncomingFoundationPageSession(stripped);
  expect(stripped.headers.has(HEADER)).toBe(false);
});

it("replaces a forged copy with the gate's own answer", async () => {
  const request = page({ headers: { [HEADER]: "forged" } });
  await handedTo(request);
  const headers = downstream(
    request,
    forwardFoundationPageSession(
      request,
      NextResponse.next({ request: { headers: request.headers } })
    )
  );
  expect(await readFoundationPageSession(headers.get(HEADER), "token-a")).toEqual({
    account,
    user,
  });
});

it("keeps the other forwarded headers and response headers unchanged", async () => {
  const request = page({ headers: { cookie: "a=1", "x-nonce": "kept" } });
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set("refreshed", "yes");
  const forwarded = forwardFoundationPageSession(request, response);
  const headers = downstream(request, forwarded);
  expect(headers.get("cookie")).toBe("a=1");
  expect(headers.get("x-nonce")).toBe("kept");
  expect(forwarded.headers.get("cache-control")).toBe("private, no-store");
  expect(forwarded.cookies.get("refreshed")?.value).toBe("yes");
});

it("forwards an answer once, and never with a redirect or refusal", async () => {
  const redirected = page();
  await handedTo(redirected);
  const redirect = NextResponse.redirect("https://verifymzansi.com/login");
  expect(
    forwardFoundationPageSession(redirected, redirect).headers.has(`x-middleware-request-${HEADER}`)
  ).toBe(false);
  // The remembered answer was consumed with the redirect.
  const later = forwardFoundationPageSession(redirected, NextResponse.next());
  expect(downstream(redirected, later).has(HEADER)).toBe(false);

  const refused = page();
  await handedTo(refused);
  expect(
    forwardFoundationPageSession(refused, NextResponse.json({}, { status: 403 })).headers.has(
      "x-middleware-override-headers"
    )
  ).toBe(false);
});

it("refuses tampered, mismatched, anonymous or oversized answers", async () => {
  const digest = await digestFoundationToken("token-a");
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const cases = [
    "not base64url!",
    encode({ v: 2, token: digest, account, user }),
    encode({ v: 1, token: digest, account, user, extra: true }),
    encode({ v: 1, token: digest, account: { ...account, account_id: other }, user }),
    encode({ v: 1, token: digest, account, user: { ...user, is_anonymous: true } }),
    encode({ v: 1, token: digest, account: { ...account, staff: "admin" }, user }),
    encode({ v: 1, token: digest, account, user }).slice(0, -4),
    "A".repeat(20_000),
    null,
    "",
  ];
  for (const value of cases) expect(await readFoundationPageSession(value, "token-a")).toBeNull();
});

it("does not hand over an answer too large for a request header", async () => {
  const request = page();
  await rememberFoundationPageSession(request, {
    tokenDigest: await digestFoundationToken("token-a"),
    account,
    user: { ...user, user_metadata: { padding: "x".repeat(20_000) } },
  });
  const headers = downstream(request, forwardFoundationPageSession(request, NextResponse.next()));
  expect(headers.has(HEADER)).toBe(false);
});
