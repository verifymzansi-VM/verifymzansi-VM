// Helpers for specs that run against the local foundation test copy (M0.7).
// Requests go only to the fixed local gateway (checked by the target guard).
// No runtime file read feeds a request: the people come from the committed
// fixture (module import), and the gateway key, post ids and authenticator
// secrets are read from the copy itself (local CLI status and the copy's own
// database container).
import { createServerClient } from "@supabase/ssr";
import people from "../fixture/people.json";
import {
  E2E_FIXTURE,
  assertLocalFoundationTarget,
} from "../../../scripts/lib/foundation-e2e-target.mjs";
import {
  openFixture,
  psql,
  readStatus,
  PUBLIC_TABLES_QUERY,
} from "../../../scripts/lib/foundation-e2e-stack.mjs";
import { nativeTotp } from "../../../scripts/lib/foundation-native-totp.mjs";

export type PersonKey = "invitedMember" | "verifiedMember" | "moderator" | "admin";

/** The only address any helper sends a request to. */
const API_ORIGIN = assertLocalFoundationTarget({
  apiUrl: `http://127.0.0.1:${E2E_FIXTURE.apiPort}`,
});

export type TestCopy = {
  publishableKey: string;
  posts: { id: string; title: string; mediaKey: string }[];
};

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

/** Read-only catalogue/count query over the copy's own database container. */
export function queryTestCopy(statement: string): string {
  return psql(openFixture(), statement);
}

/** The copy's gateway key and seeded posts, read from the running copy. */
export function readTestCopy(): TestCopy {
  const status = readStatus(openFixture());
  if (status.apiUrl !== API_ORIGIN) throw new Error("Unexpected test copy gateway");
  const posts = queryTestCopy(
    "select p.id, p.title, m.object_key from private.posts p " +
      "join private.post_media pm on pm.post_id = p.id and pm.purpose = 'cover' " +
      "join private.media_objects m on m.id = pm.object_id " +
      "where p.status = 'live' and p.title like 'Fixture %' order by p.published_at;"
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title, mediaKey] = line.split("|");
      if (!UUID.test(id) || !/^media\/[a-f0-9-]{36}$/.test(mediaKey))
        throw new Error("Unexpected seeded post");
      return { id, title, mediaKey };
    });
  return { publishableKey: status.publishableKey, posts };
}

export function countPublicTables(): number {
  return Number(psql(openFixture(), PUBLIC_TABLES_QUERY));
}

/**
 * Fixture reset, on the local copy only: deletes a test person's unpaid
 * checkouts that never reached a provider or reached only the mock, so the
 * next checkout creates a new quote and takes the provider path again.
 * Returns how many pending payments the person still has (always 0).
 */
export function clearUnpaidMockCheckouts(accountId: string): number {
  if (!UUID.test(accountId)) throw new Error("Unexpected account id");
  queryTestCopy(
    `delete from private.payments where owner_id = '${accountId}' and status = 'pending' ` +
      "and (provider_request_id is null or provider_request_id like 'mock-%');"
  );
  return Number(
    queryTestCopy(
      `select count(*) from private.payments where owner_id = '${accountId}' and status = 'pending';`
    )
  );
}

/** RFC 6238 code from the authenticator secret, computed with node:crypto. */
export function totpCode(secret: string, at = Date.now()): string {
  return nativeTotp(secret, at);
}

/** The verified authenticator factor local Auth holds for a test person. */
function authenticatorOf(key: PersonKey): { factorId: string; secret: string } | null {
  const email = people[key].email.toLowerCase().replace(/[^a-z0-9@.-]/g, "");
  const row = queryTestCopy(
    "select f.id, f.secret from auth.mfa_factors f join auth.users u on u.id = f.user_id " +
      `where lower(u.email) = '${email}' and f.factor_type = 'totp' and f.status = 'verified';`
  );
  if (!row) return null;
  const [factorId, secret] = row.split("|");
  if (!UUID.test(factorId)) throw new Error("Unexpected authenticator factor");
  return { factorId, secret };
}

async function request(
  copy: TestCopy,
  pathname: `/${string}`,
  init: { body?: unknown; token?: string; headers?: Record<string, string>; method?: string } = {}
) {
  const url = new URL(pathname, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error("Test copy requests stay on the local gateway");
  const response = await fetch(url, {
    method: init.method ?? "POST",
    redirect: "error",
    headers: {
      apikey: copy.publishableKey,
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

/** Calls a production API command through the local gateway. */
export function rpc(copy: TestCopy, name: string, body: unknown, token?: string) {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Unexpected command name");
  return request(copy, `/rest/v1/rpc/${name}`, {
    body,
    token,
    headers: { "Content-Profile": "api", "Accept-Profile": "api" },
  });
}

/** A read the retired backend's clients make: a table in schema public. */
export function retiredTableRead(copy: TestCopy, table: string) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
  return request(copy, `/rest/v1/${table}?select=id&limit=1`, {
    method: "GET",
    headers: { "Accept-Profile": "public" },
  });
}

/** Real local GoTrue password sign-in; with an authenticator, the second step too. */
export async function signIn(copy: TestCopy, key: PersonKey) {
  const login = await request(copy, "/auth/v1/token?grant_type=password", {
    body: { email: people[key].email, password: people[key].password },
  });
  if (login.status !== 200) throw new Error(`Sign-in failed for ${key} (${login.status})`);
  const factor = authenticatorOf(key);
  if (!factor)
    return {
      token: login.data.access_token as string,
      refreshToken: login.data.refresh_token as string,
      aal: "aal1",
    };
  const challenge = await request(copy, `/auth/v1/factors/${factor.factorId}/challenge`, {
    token: login.data.access_token,
  });
  const verified = await request(copy, `/auth/v1/factors/${factor.factorId}/verify`, {
    token: login.data.access_token,
    body: { challenge_id: challenge.data.id, code: totpCode(factor.secret) },
  });
  if (verified.status !== 200) throw new Error(`Authenticator step failed for ${key}`);
  const token = verified.data.access_token as string;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return { token, refreshToken: verified.data.refresh_token as string, aal: claims.aal as string };
}

/**
 * The website's session cookies for a test person, after a real local sign-in.
 * @supabase/ssr itself writes them (name, chunking, encoding), as the website's
 * own sign-in would; its only request goes to the local gateway.
 */
export async function browserSessionCookies(copy: TestCopy, key: PersonKey) {
  const session = await signIn(copy, key);
  const cookies: { name: string; value: string }[] = [];
  const auth = createServerClient(API_ORIGIN, copy.publishableKey, {
    cookies: {
      getAll: () => cookies,
      setAll: (items) => {
        for (const { name, value } of items) {
          const index = cookies.findIndex((cookie) => cookie.name === name);
          if (index >= 0) cookies.splice(index, 1);
          if (value) cookies.push({ name, value });
        }
      },
    },
    global: {
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== API_ORIGIN)
          throw new Error("Test copy requests stay on the local gateway");
        return fetch(input, init);
      },
    },
  }).auth;
  const { data, error } = await auth.setSession({
    access_token: session.token,
    refresh_token: session.refreshToken,
  });
  if (error || !data.session) throw new Error(`Session cookies failed for ${key}`);
  if (cookies.length === 0) throw new Error("No session cookie was written");
  return { accountId: data.session.user.id, cookies };
}
