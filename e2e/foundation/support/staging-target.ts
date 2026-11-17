// Read-only helpers for running fixture-smoke.spec.ts against the hosted
// staging copy (M0.15b) instead of the local test copy. The address, project
// and publishable key come only from wrangler.toml [env.staging] (all public
// values), and every request stays on that staging project's own gateway.
// No secret is read or needed: these checks are what any visitor can see.
import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import { STAGING_PROJECT_REF } from "../../../src/lib/foundation/hosted-projects";

/** Set by playwright.staging.config.ts (and the release workflow). */
export function isStagingTarget(): boolean {
  return process.env.FOUNDATION_SMOKE_TARGET === "staging";
}

export type StagingTarget = { appUrl: string; apiUrl: string; publishableKey: string };

/** The staging copy's public settings, refusing anything that names production. */
export function readStagingTarget(file = "wrangler.toml"): StagingTarget {
  const config = parse(readFileSync(file, "utf8")) as {
    env?: { staging?: { vars?: Record<string, unknown> } };
  };
  const vars = config.env?.staging?.vars ?? {};
  const text = (key: string) => {
    const value = vars[key];
    if (typeof value !== "string" || !value) throw new Error(`Staging setting ${key} is missing`);
    return value;
  };
  const ref = text("FOUNDATION_PROJECT_REF");
  const apiUrl = text("FOUNDATION_SUPABASE_URL");
  const appUrl = text("NEXT_PUBLIC_APP_URL");
  const publishableKey = text("FOUNDATION_SUPABASE_PUBLISHABLE_KEY");
  // Only the staging project, so never production.
  if (ref !== STAGING_PROJECT_REF)
    throw new Error("The staging smoke test only runs against the staging project");
  if (apiUrl !== `https://${STAGING_PROJECT_REF}.supabase.co`)
    throw new Error("Unexpected staging gateway");
  const app = new URL(appUrl);
  if (app.protocol !== "https:" || /(^|\.)verifymzansi\.com$/.test(app.hostname))
    throw new Error("The staging smoke test never runs against the production address");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey))
    throw new Error("Unexpected staging publishable key");
  return { appUrl: app.origin, apiUrl, publishableKey };
}

async function request(
  target: StagingTarget,
  pathname: `/${string}`,
  init: { body?: unknown; headers?: Record<string, string>; method?: string } = {}
) {
  const url = new URL(pathname, target.apiUrl);
  if (url.origin !== new URL(target.apiUrl).origin)
    throw new Error("Staging requests stay on the staging gateway");
  const response = await fetch(url, {
    method: init.method ?? "POST",
    redirect: "error",
    headers: {
      apikey: target.publishableKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = await response.text();
  let data: unknown = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { raw: body.slice(0, 200) };
  }
  return { status: response.status, data: data as Record<string, unknown> & { code?: string } };
}

/** Calls a public API command anonymously, as a signed-out visitor's browser does. */
export function stagingRpc(target: StagingTarget, name: string, body: unknown) {
  if (!/^[a-z_]+$/.test(name)) throw new Error("Unexpected command name");
  return request(target, `/rest/v1/rpc/${name}`, {
    body,
    headers: { "Content-Profile": "api", "Accept-Profile": "api" },
  });
}

/** A read the retired backend's clients make: a table in schema public. */
export function stagingRetiredTableRead(target: StagingTarget, table: string) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Unexpected table name");
  return request(target, `/rest/v1/${table}?select=id&limit=1`, {
    method: "GET",
    headers: { "Accept-Profile": "public" },
  });
}
