import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { openFixture } from "../../scripts/lib/foundation-e2e-stack.mjs";
import { browserSessionCookies, readTestCopy, sessionCookies, signIn } from "./support/test-copy";

// Roadmap M9.2: one sign-in check per page view. The website's page gate asks
// local Auth for the session (GET /auth/v1/user) and the database for the
// account (get_my_account_context) once; the page render of the same request
// reuses that answer. Counted at the copy's own gateway, whose access log lists
// every request the website server sends to Auth and the database (paths and
// statuses only). The page is fetched without a browser, so no script on the
// page adds its own calls.

const GATEWAY = `supabase_kong_${E2E_FIXTURE.projectId}`;

/** Requests to one gateway path so far (the copy's gateway access log). */
function gatewayCount(method: string, pathname: string) {
  const fixture = openFixture();
  const result = spawnSync("docker", [...fixture.dockerArgs, "logs", GATEWAY], {
    env: fixture.env as NodeJS.ProcessEnv,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("The test copy's gateway log is unavailable");
  const line = new RegExp(`"${method} ${pathname.replaceAll("/", "\\/")}[ ?]`);
  return `${result.stdout}\n${result.stderr}`.split("\n").filter((entry) => line.test(entry))
    .length;
}

const signInChecks = () => ({
  auth: gatewayCount("GET", "/auth/v1/user"),
  account: gatewayCount("POST", "/rest/v1/rpc/get_my_account_context"),
});

test("a dashboard view checks the sign-in once", async ({ request }) => {
  const copy = readTestCopy();
  const { cookies } = await browserSessionCookies(copy, "verifiedMember");
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  const view = async () => {
    const response = await request.get("/dashboard", {
      headers: { cookie, accept: "text/html" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    // The whole streamed page, so every server read for it has finished.
    expect(await response.text()).toContain("Lerato");
  };
  // The first view also loads the route; count the second, once the log has settled.
  await view();
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const before = signInChecks();
  await view();
  // The gateway writes its log asynchronously; wait until it has settled.
  await expect
    .poll(() => signInChecks().auth - before.auth, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const after = signInChecks();
  expect({ auth: after.auth - before.auth, account: after.account - before.account }).toEqual({
    auth: 1,
    account: 1,
  });
});

test("a browser cannot hand the page its own sign-in answer", async ({ request }) => {
  const copy = readTestCopy();
  const session = await signIn(copy, "verifiedMember");
  const { accountId, cookies } = await sessionCookies(copy, session);
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  // A well-formed answer for this member's own token that claims a ready admin.
  const forged = Buffer.from(
    JSON.stringify({
      v: 1,
      token: createHash("sha256").update(session.token).digest("base64url"),
      account: {
        version: 1,
        account_id: accountId,
        email: null,
        phone: "+27820000000",
        totp_enrolled: true,
        staff: { role: "admin", can_access: true, assigned_capabilities: ["queue:view"] },
      },
      user: { id: accountId },
    })
  ).toString("base64url");
  const headers = { cookie, accept: "text/html", "x-vm-page-session": forged };
  const admin = await request.get("/admin", { headers, maxRedirects: 0 });
  expect(admin.status()).toBe(307);
  expect(new URL(admin.headers().location, "http://x").pathname).toBe("/dashboard");
  const dashboard = await request.get("/dashboard", { headers, maxRedirects: 0 });
  expect(dashboard.status()).toBe(200);
  expect(await dashboard.text()).toContain("Lerato");
});
