// Helpers for specs that run against the local foundation test copy (M0.7).
// Every address is the local stack's; the guard refuses anything else.
import { readFileSync } from "node:fs";
import {
  E2E_FIXTURE,
  assertLocalFoundationTarget,
} from "../../../scripts/lib/foundation-e2e-target.mjs";
import {
  openFixture,
  psql,
  PUBLIC_TABLES_QUERY,
} from "../../../scripts/lib/foundation-e2e-stack.mjs";
import { nativeTotp } from "../../../scripts/lib/foundation-native-totp.mjs";

export type PersonKey = "invitedMember" | "verifiedMember" | "moderator" | "admin";

type Person = { email: string; password: string; firstName: string; lastName: string };

export type TestCopyState = {
  apiUrl: string;
  mailUrl: string;
  publishableKey: string;
  accounts: Record<PersonKey, { id: string }>;
  totp: Partial<Record<PersonKey, { factorId: string; secret: string }>>;
  posts: { key: string; id: string; title: string; kind: string; mediaKey: string }[];
};

export function readTestCopy(): TestCopyState {
  const state = JSON.parse(readFileSync(E2E_FIXTURE.stateFile, "utf8")) as TestCopyState;
  assertLocalFoundationTarget({ apiUrl: state.apiUrl });
  return state;
}

export const people = JSON.parse(
  readFileSync("e2e/foundation/fixture/people.json", "utf8")
) as Record<PersonKey, Person>;

/** Read-only count over the copy's own database container. */
export function countPublicTables(): number {
  return Number(psql(openFixture(), PUBLIC_TABLES_QUERY));
}

/** Read-only catalogue/count query over the copy's own database container. */
export function queryTestCopy(statement: string): string {
  return psql(openFixture(), statement);
}

/** RFC 6238 code from the authenticator secret, computed with node:crypto. */
export function totpCode(secret: string, at = Date.now()): string {
  return nativeTotp(secret, at);
}

async function request(
  state: TestCopyState,
  pathname: string,
  init: { body?: unknown; token?: string; headers?: Record<string, string>; method?: string } = {}
) {
  const url = new URL(pathname, state.apiUrl);
  const response = await fetch(url, {
    method: init.method ?? "POST",
    redirect: "error",
    headers: {
      apikey: state.publishableKey,
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
export function rpc(state: TestCopyState, name: string, body: unknown, token?: string) {
  return request(state, `/rest/v1/rpc/${name}`, {
    body,
    token,
    headers: { "Content-Profile": "api", "Accept-Profile": "api" },
  });
}

/** A read the retired backend's clients make: a table in schema public. */
export function retiredTableRead(state: TestCopyState, table: string) {
  return request(state, `/rest/v1/${table}?select=id&limit=1`, {
    method: "GET",
    headers: { "Accept-Profile": "public" },
  });
}

/** Real local GoTrue password sign-in; with a factor, the authenticator step too. */
export async function signIn(state: TestCopyState, key: PersonKey) {
  const login = await request(state, "/auth/v1/token?grant_type=password", {
    body: { email: people[key].email, password: people[key].password },
  });
  if (login.status !== 200) throw new Error(`Sign-in failed for ${key} (${login.status})`);
  const factor = state.totp[key];
  if (!factor) return { token: login.data.access_token as string, aal: "aal1" };
  const challenge = await request(state, `/auth/v1/factors/${factor.factorId}/challenge`, {
    token: login.data.access_token,
  });
  const verified = await request(state, `/auth/v1/factors/${factor.factorId}/verify`, {
    token: login.data.access_token,
    body: { challenge_id: challenge.data.id, code: totpCode(factor.secret) },
  });
  if (verified.status !== 200) throw new Error(`Authenticator step failed for ${key}`);
  const token = verified.data.access_token as string;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return { token, aal: claims.aal as string };
}
