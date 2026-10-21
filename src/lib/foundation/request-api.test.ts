/** @vitest-environment node */
import { expect, it, vi } from "vitest";
import { createFoundationRequestApi } from "./request-api";
import { createFoundationRouteContext } from "./request-route";
import { NextRequest, NextResponse } from "next/server";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  expectedProjectRef: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_synthetic",
};
const token = (n = 1, overrides: Record<string, unknown> = {}) =>
  [
    Buffer.from('{"alg":"ES256"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        role: "authenticated",
        sub: id(n),
        session_id: id(n + 100),
        iss: `${config.url}/auth/v1`,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...overrides,
      })
    ).toString("base64url"),
    "unsigned_synthetic_unit_only",
  ].join(".");
const session = (accessToken: string, n = 1, expiresAt = Math.floor(Date.now() / 1000) + 3600) => ({
  access_token: accessToken,
  refresh_token: "synthetic-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: expiresAt,
  user: { id: id(n), app_metadata: { role: "untrusted-cookie-value" } },
});
function cookieAdapter(value: unknown) {
  const jar = new Map<string, string>(
    value === null
      ? []
      : [
          [
            "sb-abcdefghijklmnopqrst-auth-token",
            "base64-" + Buffer.from(JSON.stringify(value)).toString("base64url"),
          ],
        ]
  );
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: vi.fn(
      (items: Array<{ name: string; value: string }>, _headers: Record<string, string>) => {
        for (const item of items) jar.set(item.name, item.value);
      }
    ),
  };
}
const user = (n = 1, anonymous = false) => ({
  id: id(n),
  aud: "authenticated",
  email_confirmed_at: "2026-10-01T00:00:00Z",
  is_anonymous: anonymous,
});

it("verifies exact caller tokens with real SSR/SDK transport and isolates concurrent requests", async () => {
  const tokens = [token(1), token(2)];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url));
    expect(target.origin).toBe(config.url);
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
    const headers = new Headers(init?.headers);
    expect(headers.get("apikey")).toBe(config.publishableKey);
    expect(headers.has("cookie")).toBe(false);
    const index = tokens.indexOf(headers.get("authorization")!.slice(7));
    expect(index).toBeGreaterThanOrEqual(0);
    if (target.pathname === "/auth/v1/user") return Response.json(user(index + 1));
    expect(target.pathname).toBe("/rest/v1/rpc/staff_identity_history");
    expect(init?.method).toBe("POST");
    expect(headers.get("content-profile")).toBe("api");
    return Response.json({ caller: index + 1 });
  });
  const apis = await Promise.all(
    tokens.map((value, i) =>
      // The user embedded in the cookie is deliberately wrong: only GoTrue is trusted.
      createFoundationRequestApi(config, cookieAdapter(session(value, i + 10)), fetcher)
    )
  );
  expect(apis.map(Object.keys)).toEqual([["rpc"], ["rpc"]]);
  const results = await Promise.all(
    apis.map((api) => api.rpc("staff_identity_history", { p_owner: id(20) }, { get: false }))
  );
  expect(results.map((result) => result.data)).toEqual([{ caller: 1 }, { caller: 2 }]);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it.each([
  token(1, { iss: "https://other.supabase.co/auth/v1" }),
  token(1, { role: "service_role" }),
  token(1, { sub: "invalid" }),
  token(1, { session_id: "invalid" }),
  token(1, { exp: 1 }),
  "sb_secret_synthetic",
  "malformed",
])("rejects wrong issuer, identity, role or expiry before Auth HTTP %#", async (value) => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    createFoundationRequestApi(config, cookieAdapter(session(value)), fetcher)
  ).rejects.toThrow("A verified foundation account session is required");
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects missing sessions without an Auth or data request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(createFoundationRequestApi(config, cookieAdapter(null), fetcher)).rejects.toThrow(
    "A verified foundation account session is required"
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["denied", "different-user", "anonymous"])(
  "never exposes RPCs for an unverified caller: %s",
  async (kind) => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      kind === "denied"
        ? Response.json({ msg: "synthetic denial" }, { status: 401 })
        : Response.json(user(kind === "different-user" ? 2 : 1, kind === "anonymous"))
    );
    await expect(
      createFoundationRequestApi(config, cookieAdapter(session(token())), fetcher)
    ).rejects.toThrow("A verified foundation account session is required");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toBe(`${config.url}/auth/v1/user`);
  }
);

it("uses the refreshed token and forwards SSR cookie writes plus mandatory cache headers", async () => {
  const fresh = token(1, { session_id: id(300) });
  const jar = cookieAdapter(session(token(1, { exp: 1 }), 1, 1));
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const target = new URL(String(url));
    if (target.pathname === "/auth/v1/token") {
      expect(target.searchParams.get("grant_type")).toBe("refresh_token");
      return Response.json({ ...session(fresh), user: user() });
    }
    expect(target.pathname).toBe("/auth/v1/user");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${fresh}`);
    return Response.json(user());
  });
  const api = await createFoundationRequestApi(config, jar, fetcher);
  expect(Object.keys(api)).toEqual(["rpc"]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(jar.setAll).toHaveBeenCalled();
  expect(jar.setAll.mock.calls[0][1]).toMatchObject({
    "Cache-Control": expect.stringContaining("no-store"),
    Pragma: "no-cache",
    Expires: "0",
  });
});

it("rejects source projects and incomplete cookie adapters before inspecting cookies", async () => {
  const jar = cookieAdapter(null);
  const getAll = vi.spyOn(jar, "getAll");
  await expect(
    createFoundationRequestApi(
      {
        ...config,
        url: "https://tnygdgormnofpgjknlhr.supabase.co",
        expectedProjectRef: "tnygdgormnofpgjknlhr",
      },
      jar
    )
  ).rejects.toThrow("Unexpected foundation project identity");
  expect(getAll).not.toHaveBeenCalled();
  await expect(
    createFoundationRequestApi(config, { getAll } as unknown as Parameters<
      typeof createFoundationRequestApi
    >[1])
  ).rejects.toThrow("A complete request cookie adapter is required");
});

it("does not return an authenticated API when refreshed cookies cannot be persisted", async () => {
  const jar = cookieAdapter(session(token(1, { exp: 1 }), 1, 1));
  jar.setAll.mockImplementation(() => {
    throw new Error("Synthetic cookie write failure");
  });
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ ...session(token()), user: user() })
  );
  try {
    await expect(createFoundationRequestApi(config, jar, fetcher)).rejects.toThrow(
      "A verified foundation account session is required"
    );
    expect(
      fetcher.mock.calls.every(([url]) => new URL(String(url)).pathname === "/auth/v1/token")
    ).toBe(true);
  } finally {
    errorLog.mockRestore();
  }
});

it("route responses retain refreshed cookies, override shared caching and authenticate once", async () => {
  const fresh = token(1, { session_id: id(300) });
  const cookies = cookieAdapter(session(token(1, { exp: 1 }), 1, 1));
  const request = new NextRequest("https://verifymzansi.com/api/foundation/example", {
    headers: {
      cookie: cookies
        .getAll()
        .map(({ name, value }) => `${name}=${value}`)
        .join("; "),
    },
  });
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/auth/v1/token") return Response.json({ ...session(fresh), user: user() });
    expect(path).toBe("/auth/v1/user");
    return Response.json(user());
  });
  const context = createFoundationRouteContext(config, request, fetcher);
  expect(Object.keys(context)).toEqual(["authenticate", "respond"]);
  const first = context.authenticate();
  expect(context.authenticate()).toBe(first);
  await first;
  const response = await context.respond(
    NextResponse.json({ ok: true }, { headers: { "Cache-Control": "public, max-age=3600" } })
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(response.cookies.get("sb-abcdefghijklmnopqrst-auth-token")?.value).toContain("base64-");
  expect(response.headers.get("Cache-Control")).toContain("private, no-cache, no-store");
  expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
  expect(response.headers.get("Cloudflare-CDN-Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true });
});

it("failed route refresh clears expired cookies and makes its error response uncacheable", async () => {
  const cookies = cookieAdapter(session(token(1, { exp: 1 }), 1, 1));
  const request = new NextRequest("https://verifymzansi.com/api/foundation/example", {
    headers: {
      cookie: cookies
        .getAll()
        .map(({ name, value }) => `${name}=${value}`)
        .join("; "),
    },
  });
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      { code: "refresh_token_not_found", msg: "synthetic expired session" },
      { status: 400 }
    )
  );
  const context = createFoundationRouteContext(config, request, fetcher);
  await expect(context.authenticate()).rejects.toThrow(
    "A verified foundation account session is required"
  );
  const response = await context.respond(
    NextResponse.json({ error: "Sign in again" }, { status: 401 })
  );
  expect(response.status).toBe(401);
  expect(response.cookies.get("sb-abcdefghijklmnopqrst-auth-token")?.value).toBe("");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(response.headers.get("Expires")).toBe("0");
  expect(response.headers.get("Pragma")).toBe("no-cache");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
