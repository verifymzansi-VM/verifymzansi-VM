/** @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { handleMiddlewareRequest } from "@/proxy-handler";
import {
  readFoundationServerSession,
  readFoundationServerUser,
} from "@/lib/foundation/server-session";
import { FOUNDATION_PAGE_SESSION_HEADER } from "@/lib/foundation/page-session-handoff";

// One sign-in check per page view: the proxy's page gate verifies the session
// with Auth and reads the account context once, and the page render of the same
// request (layout and page alike) reuses that answer. Counted here through the
// network calls the real gate, bridge and page session make.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
let render: { cookies: Map<string, string>; headers: Headers } | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...(render?.cookies ?? [])].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => render?.headers ?? new Headers(),
}));

const ref = "gntzjtuncsyefujajmjy";
const url = `https://${ref}.supabase.co`;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cookieName = `sb-${ref}-auth-token`;
const accessToken = (n = 1, session = 100) =>
  [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        role: "authenticated",
        sub: id(n),
        session_id: id(session),
        iss: `${url}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url"),
    "unsigned_synthetic_unit_only",
  ].join(".");
const sessionCookie = (token: string) =>
  "base64-" +
  Buffer.from(
    JSON.stringify({
      access_token: token,
      refresh_token: "synthetic-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: id(1) },
    })
  ).toString("base64url");
const context = (staff: unknown = null) => ({
  version: 1,
  account_id: id(1),
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
  totp_enrolled: staff !== null,
  staff,
});

let accountContext: ReturnType<typeof context>;
let authAccepts = true;
const calls: string[] = [];
const fetcher = vi.fn<typeof fetch>(async (input) => {
  const { pathname } = new URL(input instanceof Request ? input.url : String(input));
  calls.push(pathname);
  if (pathname === "/auth/v1/user" && !authAccepts)
    return Response.json({ msg: "session_not_found" }, { status: 403 });
  if (pathname === "/auth/v1/user")
    return Response.json({
      id: id(1),
      aud: "authenticated",
      email: "member@example.invalid",
      email_confirmed_at: "2026-10-01T00:00:00Z",
      is_anonymous: false,
    });
  if (pathname === "/rest/v1/rpc/get_my_account_context") return Response.json(accountContext);
  return new Response(null, { status: 404 });
});
const count = () => ({
  authUser: calls.filter((path) => path === "/auth/v1/user").length,
  accountContext: calls.filter((path) => path.endsWith("/get_my_account_context")).length,
});

beforeEach(() => {
  calls.length = 0;
  render = null;
  authAccepts = true;
  accountContext = context();
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_synthetic");
  vi.stubEnv("FOUNDATION_SUPABASE_URL", url);
  vi.stubEnv("FOUNDATION_PROJECT_REF", ref);
  vi.stubEnv("FOUNDATION_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** The request the page render receives, with Next's request-header overrides applied. */
function renderOf(request: NextRequest, response: NextResponse) {
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
  const cookies = new Map(
    (headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)])
  );
  return { cookies, headers };
}

function pageRequest(
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {}
) {
  return new NextRequest("https://verifymzansi.com" + path, {
    method: init.method ?? "GET",
    headers: {
      accept: "text/html",
      cookie: `${cookieName}=${sessionCookie(accessToken())}`,
      ...init.headers,
    },
  });
}

/** Gate, then a layout and a page that each ask for the session (as /admin does). */
async function view(request: NextRequest) {
  const response = await handleMiddlewareRequest(request);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  render = renderOf(request, response);
  const layout = await readFoundationServerSession();
  const pageUser = await readFoundationServerUser();
  return { layout, pageUser, response };
}

it("checks the sign-in once for a whole dashboard view", async () => {
  const { layout, pageUser } = await view(pageRequest("/dashboard"));
  expect(count()).toEqual({ authUser: 1, accountContext: 1 });
  expect(layout.account.account_id).toBe(id(1));
  expect(pageUser?.id).toBe(id(1));
});

it("keeps staff two-step status exactly as the gate read it", async () => {
  accountContext = context({ role: "moderator", can_access: true, assigned_capabilities: [] });
  const { layout } = await view(pageRequest("/admin"));
  expect(count()).toEqual({ authUser: 1, accountContext: 1 });
  expect(layout.account.staff).toEqual(accountContext.staff);
});

it("checks in full when a browser sends its own copy of the handed-over answer", async () => {
  const forged = Buffer.from(
    JSON.stringify({ v: 1, token: "x".repeat(43), account: context(), user: { id: id(1) } })
  ).toString("base64url");
  // A public page reached with a forged answer: the proxy removes it.
  const request = pageRequest("/organisation-invite", {
    headers: { [FOUNDATION_PAGE_SESSION_HEADER]: forged },
  });
  const response = await handleMiddlewareRequest(request);
  render = renderOf(request, response);
  expect(render.headers.has(FOUNDATION_PAGE_SESSION_HEADER)).toBe(false);
  await readFoundationServerSession();
  expect(count()).toEqual({ authUser: 1, accountContext: 1 });
});

it("replaces a forged staff answer on a protected page with the gate's own", async () => {
  const forged = Buffer.from(
    JSON.stringify({
      v: 1,
      token: "x".repeat(43),
      account: context({ role: "admin", can_access: true, assigned_capabilities: ["queue:view"] }),
      user: { id: id(1) },
    })
  ).toString("base64url");
  const { layout } = await view(
    pageRequest("/dashboard", { headers: { [FOUNDATION_PAGE_SESSION_HEADER]: forged } })
  );
  expect(layout.account.staff).toBeNull();
  expect(count()).toEqual({ authUser: 1, accountContext: 1 });
});

it("checks in full when the page's cookies carry a different token than the gate verified", async () => {
  const request = pageRequest("/dashboard");
  const response = await handleMiddlewareRequest(request);
  render = renderOf(request, response);
  render.cookies.set(cookieName, sessionCookie(accessToken(1, 101)));
  await readFoundationServerSession();
  expect(count()).toEqual({ authUser: 2, accountContext: 2 });
});

it("ignores a handed answer on a request a platform may route past the proxy", async () => {
  const request = pageRequest("/dashboard");
  const response = await handleMiddlewareRequest(request);
  render = renderOf(request, response);
  expect(render.headers.has(FOUNDATION_PAGE_SESSION_HEADER)).toBe(true);
  render.headers.set("x-prerender-revalidate", "anything");
  await readFoundationServerSession();
  expect(count()).toEqual({ authUser: 2, accountContext: 2 });
});

it("hands nothing over for a request that is not a page read", async () => {
  const request = pageRequest("/dashboard", { method: "POST" });
  const response = await handleMiddlewareRequest(request);
  render = renderOf(request, response);
  expect(render.headers.has(FOUNDATION_PAGE_SESSION_HEADER)).toBe(false);
  const api = pageRequest("/api/account");
  render = renderOf(api, await handleMiddlewareRequest(api));
  expect(render.headers.has(FOUNDATION_PAGE_SESSION_HEADER)).toBe(false);
});

it("still refuses a page without a session before any render", async () => {
  const request = new NextRequest("https://verifymzansi.com/dashboard", {
    headers: { accept: "text/html", [FOUNDATION_PAGE_SESSION_HEADER]: "forged" },
  });
  const response = await handleMiddlewareRequest(request);
  expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  expect(response.headers.has("x-middleware-override-headers")).toBe(false);
  expect(count()).toEqual({ authUser: 0, accountContext: 0 });
});

it("still refuses a page whose session Auth no longer accepts", async () => {
  authAccepts = false;
  const response = await handleMiddlewareRequest(pageRequest("/dashboard"));
  expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  expect(count()).toEqual({ authUser: 1, accountContext: 0 });
});
