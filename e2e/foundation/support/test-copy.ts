// Helpers for specs that run against the local foundation test copy (M0.7).
// Requests go only to the fixed local gateway (checked by the target guard).
// No runtime file read feeds a request: the people come from the committed
// fixture (module import), and the gateway key, post ids and authenticator
// secrets are read from the copy itself (local CLI status and the copy's own
// database container).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import people from "../fixture/people.json";
import {
  E2E_FIXTURE,
  OUTBOUND_LOG_FILE,
  TEST_SMS_SINK_FILE,
  assertLocalFoundationTarget,
} from "../../../scripts/lib/foundation-e2e-target.mjs";
import {
  openFixture,
  psql,
  readStatus,
  PUBLIC_TABLES_QUERY,
} from "../../../scripts/lib/foundation-e2e-stack.mjs";
import { nativeTotp } from "../../../scripts/lib/foundation-native-totp.mjs";
import { IDEMPOTENCY_HEADER } from "../../../scripts/lib/foundation-e2e-mail-relay.mjs";

export type PersonKey = "invitedMember" | "verifiedMember" | "moderator" | "admin";
/** A fixture person, or a person a spec registered during its own run. */
export type Person = PersonKey | { email: string; password: string };

function credentialsOf(person: Person) {
  return typeof person === "string" ? people[person] : person;
}

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

/** Email-job rows that one run of the job could claim now (any recipient). */
export function dueOutboxCount(): number {
  return Number(
    queryTestCopy(
      "select count(*) from private.outbox_events where processed_at is null and delivery_attempts < 8 " +
        "and delivery_after <= now() and (delivery_until is null or delivery_until < now());"
    )
  );
}

/**
 * Trusted local step (copy only): queues one website notice for a test person,
 * as the database's own commands do, so a spec can follow one email-job row
 * from the database to the mail catcher. Returns the row id.
 */
export function queueMailCheckNotice(accountId: string): string {
  if (!UUID.test(accountId)) throw new Error("Unexpected account id");
  const id = queryTestCopy(
    "insert into private.outbox_events(kind, subject_id, owner_id, dedupe_key) " +
      `values ('trial_started', gen_random_uuid(), '${accountId}', 'fixture-mail-check:' || gen_random_uuid()) returning id;`
  );
  if (!UUID.test(id)) throw new Error("Unexpected outbox id");
  return id;
}

export type OutboxState = { processed: boolean; attempts: number; error: string | null };

/** Delivery state of one email-job row. */
export function outboxState(id: string): OutboxState {
  if (!UUID.test(id)) throw new Error("Unexpected outbox id");
  const row = queryTestCopy(
    "select processed_at is not null, delivery_attempts, coalesce(delivery_error, '') " +
      `from private.outbox_events where id = '${id}';`
  );
  if (!row) throw new Error("Unknown outbox row");
  const [processed, attempts, error] = row.split("|");
  return { processed: processed === "t", attempts: Number(attempts), error: error || null };
}

/** Saved enquiries for a post (count only). */
export function enquiryCount(postId: string): number {
  if (!UUID.test(postId)) throw new Error("Unexpected post id");
  return Number(
    queryTestCopy(`select count(*) from private.enquiries where post_id = '${postId}';`)
  );
}

const MAIL_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.mailPort}`;

export type CaughtMail = { id: string; subject: string; text: string };

/**
 * The message the website sent for one email-job row, found in the local mail
 * catcher by recipient and the provider idempotency key the relay keeps
 * (foundation-outbox/<row id>). Requests go only to the fixed local catcher.
 */
export async function caughtMailFor(
  recipient: string,
  idempotencyKey: string,
  { timeoutMs = 15_000 } = {}
): Promise<CaughtMail> {
  const wanted = recipient.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  const get = async (pathname: string) => {
    const url = new URL(pathname, MAIL_ORIGIN);
    if (url.origin !== MAIL_ORIGIN) throw new Error("Mail lookups stay on the local catcher");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Mail catcher answered ${response.status}`);
    return response.json();
  };
  while (Date.now() < deadline) {
    const list = await get("/api/v1/messages?limit=100");
    for (const item of list.messages ?? []) {
      if (!/^[A-Za-z0-9]{8,64}$/.test(item.ID)) continue;
      if (!(item.To ?? []).some((to: { Address: string }) => to.Address.toLowerCase() === wanted))
        continue;
      const headers = await get(`/api/v1/message/${item.ID}/headers`);
      if (!(headers[IDEMPOTENCY_HEADER] ?? []).includes(idempotencyKey)) continue;
      const message = await get(`/api/v1/message/${item.ID}`);
      return { id: item.ID, subject: String(message.Subject), text: String(message.Text ?? "") };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The website's email did not reach the local mail catcher");
}

/** RFC 6238 code from the authenticator secret, computed with node:crypto. */
export function totpCode(secret: string, at = Date.now()): string {
  return nativeTotp(secret, at);
}

/** The verified authenticator factor local Auth holds for a test person. */
function authenticatorOf(person: Person): { factorId: string; secret: string } | null {
  const email = credentialsOf(person)
    .email.toLowerCase()
    .replace(/[^a-z0-9@.-]/g, "");
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
export async function signIn(copy: TestCopy, person: Person) {
  const { email, password } = credentialsOf(person);
  const key = typeof person === "string" ? person : "a registered test person";
  const login = await request(copy, "/auth/v1/token?grant_type=password", {
    body: { email, password },
  });
  if (login.status !== 200) throw new Error(`Sign-in failed for ${key} (${login.status})`);
  const factor = authenticatorOf(person);
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
export async function browserSessionCookies(copy: TestCopy, person: Person) {
  const key = typeof person === "string" ? person : "a registered test person";
  const session = await signIn(copy, person);
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

/** The newest message to an address in the local mail catcher, received at
 * or after `after` (ms since the epoch). Requests go only to the local catcher. */
export async function latestMailTo(
  recipient: string,
  { after = 0, timeoutMs = 20_000 }: { after?: number; timeoutMs?: number } = {}
): Promise<CaughtMail> {
  const wanted = recipient.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  const get = async (pathname: string) => {
    const url = new URL(pathname, MAIL_ORIGIN);
    if (url.origin !== MAIL_ORIGIN) throw new Error("Mail lookups stay on the local catcher");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Mail catcher answered ${response.status}`);
    return response.json();
  };
  while (Date.now() < deadline) {
    const list = await get("/api/v1/messages?limit=100");
    const item = (list.messages ?? []).find(
      (entry: { ID: string; Created: string; To?: { Address: string }[] }) =>
        /^[A-Za-z0-9]{8,64}$/.test(entry.ID) &&
        Date.parse(entry.Created) >= after &&
        (entry.To ?? []).some((to) => to.Address.toLowerCase() === wanted)
    );
    if (item) {
      const message = await get(`/api/v1/message/${item.ID}`);
      return { id: item.ID, subject: String(message.Subject), text: String(message.Text ?? "") };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("No email to this address reached the local mail catcher");
}

/** Every message to an address in the local mail catcher (count only). */
export async function mailCountTo(recipient: string): Promise<number> {
  const wanted = recipient.toLowerCase();
  const url = new URL("/api/v1/messages?limit=500", MAIL_ORIGIN);
  if (url.origin !== MAIL_ORIGIN) throw new Error("Mail lookups stay on the local catcher");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Mail catcher answered ${response.status}`);
  const list = await response.json();
  return (list.messages ?? []).filter((entry: { To?: { Address: string }[] }) =>
    (entry.To ?? []).some((to) => to.Address.toLowerCase() === wanted)
  ).length;
}

function readJsonLines<T>(file: string): T[] {
  const full = path.resolve(process.cwd(), file);
  if (!existsSync(full)) return [];
  return readFileSync(full, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export type TestSms = { to: string; message: string; at: string };

/** The SMS the copy's website would have sent (its e2e branch writes them to
 * the local sink instead of contacting the SMS provider). */
export function readTestSms(): TestSms[] {
  return readJsonLines<TestSms>(TEST_SMS_SINK_FILE);
}

export type OutboundAttempt = {
  origin: string;
  outcome: "answered-locally" | "blocked";
  at: string;
};

/** Requests the copy's website tried to send off this machine (origins only);
 * the copy's fence answered the password breach check and refused the rest. */
export function readOutboundAttempts(): OutboundAttempt[] {
  return readJsonLines<OutboundAttempt>(OUTBOUND_LOG_FILE);
}
