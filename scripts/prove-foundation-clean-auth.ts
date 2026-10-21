import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server.js";
import { createFoundationRequestApi } from "../src/lib/foundation/request-api";
import { createFoundationRouteContext } from "../src/lib/foundation/request-route";
import {
  acceptFoundationPostingTerms,
  readFoundationOwnerPostingTerms,
} from "../src/lib/foundation/posting-terms";
import { readPostingTermsCatalogue } from "./lib/foundation-posting-terms-catalogue.mjs";

// Parent owns both processes and the disposable clean database. Credentials stay
// on stdin/in memory. This transport replaces local Kong path routing only.
async function run() {
  let stage = "input",
    userId: string | undefined,
    adminToken: string | undefined,
    cleanup = "NOT_CREATED";
  const admin = async (path: string, method: string, body?: unknown) => {
    assert.ok(path === "/admin/users" || /^\/admin\/users\/[a-f0-9-]{36}$/.test(path));
    return fetch(`http://127.0.0.1:55444${path}`, {
      method,
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  };
  let outcome: Record<string, unknown>;
  try {
    assert.equal(process.argv.length, 2);
    const input = JSON.parse(readFileSync(0, "utf8"));
    assert.deepEqual(Object.keys(input), ["adminToken"]);
    assert.match(input.adminToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const claims = JSON.parse(Buffer.from(input.adminToken.split(".")[1], "base64url").toString());
    assert.equal(claims.role, "service_role");
    const now = Math.floor(Date.now() / 1000);
    assert.ok(claims.exp > now && claims.exp <= now + 120);
    adminToken = input.adminToken;
    const config = {
      url: "http://127.0.0.1:55443",
      expectedProjectRef: "local-foundation",
      publishableKey: "sb_publishable_synthetic_clean_auth_proof",
    };
    let authRequests = 0,
      rpcRequests = 0;
    const transport: typeof fetch = async (request, init) => {
      const url = new URL(String(request));
      assert.equal(url.origin, config.url);
      const headers = new Headers(init?.headers);
      assert.equal(headers.has("cookie"), false);
      let target;
      if (url.pathname.startsWith("/auth/v1/")) {
        assert.ok(["/token", "/user", "/logout"].includes(url.pathname.slice(8)));
        target = `http://127.0.0.1:55444${url.pathname.slice(8)}${url.search}`;
        authRequests++;
      } else {
        assert.ok(
          ["get_owner_posting_terms", "accept_posting_terms", "staff_identity_history"].some(
            (name) => url.pathname === `/rest/v1/rpc/${name}`
          )
        );
        assert.equal(headers.get("content-profile"), "api");
        assert.match(
          headers.get("authorization") ?? "",
          /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
        );
        target = `${config.url}${url.pathname.replace("/rest/v1", "")}${url.search}`;
        rpcRequests++;
      }
      return fetch(target, {
        ...init,
        headers,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    };
    const member = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: transport },
    });
    const email = `clean-foundation-${randomUUID()}@example.invalid`,
      password = randomBytes(32).toString("base64url");
    stage = "fresh unconfirmed synthetic account";
    const created = await admin("/admin/users", "POST", {
      email,
      password,
      email_confirm: false,
      user_metadata: { role: "admin" },
    });
    assert.equal(created.status, 200);
    const user = await created.json();
    assert.match(user.id, /^[a-f0-9-]{36}$/);
    userId = user.id;
    assert.equal(user.email_confirmed_at, undefined);
    const denied = await member.auth.signInWithPassword({ email, password });
    assert.equal(denied.data.session, null);
    assert.equal(denied.error?.code, "email_not_confirmed");
    stage = "explicit local fixture confirmation and genuine password sign-in";
    assert.equal(
      (await admin(`/admin/users/${userId}`, "PUT", { email_confirm: true })).status,
      200
    );
    const login = await member.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    assert.ok(login.data.session);
    const session = login.data.session!;
    const caller = JSON.parse(
      Buffer.from(session.access_token.split(".")[1], "base64url").toString()
    );
    assert.equal(caller.sub, userId);
    assert.equal(caller.iss, config.url + "/auth/v1");
    assert.equal(caller.role, "authenticated");
    assert.match(caller.session_id, /^[a-f0-9-]{36}$/);
    const cookieName = "sb-127-auth-token";
    const cookies = [
      {
        name: cookieName,
        value:
          "base64-" +
          Buffer.from(
            JSON.stringify({
              ...session,
              user: { ...session.user, id: randomUUID(), app_metadata: { role: "admin" } },
            })
          ).toString("base64url"),
      },
    ];
    stage = "verified caller and clean schema consent";
    const api = await createFoundationRequestApi(
      config,
      { getAll: () => cookies, setAll: () => {} },
      transport
    );
    assert.deepEqual(Object.keys(api), ["rpc"]);
    const parts = session.access_token.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    await assert.rejects(
      () =>
        createFoundationRequestApi(
          config,
          {
            getAll: () => [
              {
                name: cookieName,
                value:
                  "base64-" +
                  Buffer.from(
                    JSON.stringify({ ...session, access_token: parts.join(".") })
                  ).toString("base64url"),
              },
            ],
            setAll: () => {},
          },
          transport
        ),
      /^Error: A verified foundation account session is required$/
    );
    const current = await readFoundationOwnerPostingTerms(api);
    const catalogue = readPostingTermsCatalogue();
    const published = catalogue.documents.find((d) => d.version === catalogue.activeVersion)!;
    assert.deepEqual(current, {
      ...published,
      document_path: `/terms/versions/${published.version}`,
      accepted_at: null,
    });
    const consent = {
      version: published.version,
      document_hash: published.document_hash,
      accepted: true,
    };
    const accepted = await acceptFoundationPostingTerms(api, consent);
    assert.ok(accepted.accepted_at);
    assert.deepEqual(await acceptFoundationPostingTerms(api, consent), accepted);
    const privilege = await api.rpc("staff_identity_history", { p_owner: userId! });
    assert.equal(privilege.data, null);
    assert.equal(privilege.error?.code, "42501");
    stage = "real refresh and Next response cookie propagation";
    const expiredCookie =
      "base64-" + Buffer.from(JSON.stringify({ ...session, expires_at: 1 })).toString("base64url");
    const request = new NextRequest(config.url + "/api/foundation/example", {
      headers: { cookie: `${cookieName}=${expiredCookie}` },
    });
    const context = createFoundationRouteContext(config, request, transport);
    const refreshed = await context.authenticate();
    assert.deepEqual(await readFoundationOwnerPostingTerms(refreshed), accepted);
    const response = await context.respond(NextResponse.json({ ok: true }));
    assert.ok(response.cookies.get(cookieName)?.value);
    assert.notEqual(response.cookies.get(cookieName)?.value, expiredCookie);
    assert.ok(response.headers.get("Cache-Control")?.includes("no-store"));
    assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
    stage = "genuine logout denies still-signed access at SQL boundary";
    assert.equal((await member.auth.signOut({ scope: "global" })).error, null);
    await assert.rejects(
      () => readFoundationOwnerPostingTerms(refreshed),
      /^Error: Posting terms status is temporarily unavailable$/
    );
    outcome = {
      status:
        "PASS real fresh Auth, account/version consent, refresh and revoked-session SQL denial",
      confirmationRequired: true,
      fixtureConfirmationOnly: true,
      cookieUserAndMetadataDistrusted: true,
      forgedSignatureDenied: true,
      noAutomaticAdministrator: true,
      oncePerVersion: true,
      realRefreshAndResponseCookies: true,
      noStore: true,
      actualLogoutInvalidatesCommands: true,
      requests: { auth: authRequests, rpc: rpcRequests },
      externalMessages: 0,
    };
  } catch {
    outcome = { status: "FAIL", stage };
    process.exitCode = 1;
  } finally {
    if (userId) {
      try {
        assert.equal((await admin(`/admin/users/${userId}`, "DELETE")).status, 200);
        cleanup = "PASS exact synthetic Auth account deleted";
      } catch {
        cleanup = "INCOMPLETE";
        process.exitCode = 1;
      }
    }
  }
  outcome.syntheticAccountCleanup = cleanup;
  if (cleanup === "INCOMPLETE") outcome.status = "INCOMPLETE";
  process.stdout.write(JSON.stringify(outcome) + "\n");
}
void run();
