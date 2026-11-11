// Read-only probe of the hosted London Data API exposure, using only the public
// publishable key. It never signs in, writes, or reads application rows.
//
//   node scripts/check-foundation-hosted-exposure.mjs --stage=pre-cutover|cutover
//
// Reads FOUNDATION_SUPABASE_URL and FOUNDATION_SUPABASE_PUBLISHABLE_KEY.
// Always: private and internal are not exposed and GraphQL answers no queries.
// Before cutover api is not exposed either; at cutover it is the only exposed
// schema: a probe of a schema that cannot exist must be refused with the
// gateway's list of exposed schemas, and that list must be exactly `api`.
// Always: Auth's public settings show mailer_autoconfirm off, so sign-ups and
// email changes need their confirmation links, and anonymous sign-ins off (no
// code uses them).
//
// A network error or a 5xx answer is retried (3 tries, 5 s apart) and then
// reported as INCONCLUSIVE (exit 3), never as "exposed": a failure that says a
// schema is exposed is always a real answer from the gateway.
//
// Not checked here: "Secure email change", "Secure password change" and
// "Require current password when updating". Auth's public settings do not
// include them (GoTrue v2.197.0 lists only providers, disable_signup,
// mailer_autoconfirm, phone_autoconfirm, sms_provider, saml_enabled and
// passkeys_enabled), so they are checked in the dashboard before each deploy.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice(8);
assert.ok(["pre-cutover", "cutover"].includes(stage ?? ""), "Pass --stage=pre-cutover|cutover");
const url = new URL(process.env.FOUNDATION_SUPABASE_URL ?? "");
assert.equal(url.protocol, "https:");
assert.match(url.hostname, /^gntzjtuncsyefujajmjy\.supabase\.co$/);
const key = process.env.FOUNDATION_SUPABASE_PUBLISHABLE_KEY ?? "";
assert.match(key, /^sb_publishable_[A-Za-z0-9_-]+$/);
const RETRY_DELAY_MS = Number(process.env.EXPOSURE_RETRY_DELAY_MS ?? 5000);

class Inconclusive extends Error {}

// One request, retried on network errors and 5xx answers only.
async function read(path, init) {
  let last = "no answer";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(new URL(path, url), {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (response.status < 500) {
        const body = await response.json().catch(() => null);
        return { status: response.status, body };
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.name : "error";
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  throw new Inconclusive(`${path} did not answer (${last})`);
}

const probe = async (schema) => {
  // The schema check runs before function lookup, so an unexposed schema
  // answers PGRST106 whatever the name; api's anon-callable terms read is used.
  // PostgREST picks a POST's schema from Content-Profile.
  const { status, body } = await read("/rest/v1/rpc/get_current_posting_terms", {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      "Accept-Profile": schema,
    },
    body: "{}",
  });
  return {
    schema,
    status,
    code: body?.code ?? null,
    text: [body?.hint, body?.message, body?.details].filter((v) => typeof v === "string").join(" "),
  };
};
const exposed = (result) => result.status !== 406 || result.code !== "PGRST106";

/** The gateway's own list of exposed schemas, from a PGRST106 answer. */
function exposedList(result) {
  const match =
    /Only the following schemas are exposed:\s*([a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)*)/i.exec(
      result.text
    );
  return match
    ? match[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .sort()
    : null;
}

try {
  const results = [];
  for (const schema of ["api", "private", "internal", "public", "graphql_public"])
    results.push(await probe(schema));
  // A schema name that cannot exist: the refusal lists what is exposed.
  const unknown = await probe(`vm_probe_${randomBytes(6).toString("hex")}`);
  const graphql = await read("/graphql/v1", {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
  });
  const settings = await read("/auth/v1/settings", { headers: { apikey: key } });
  const report = {
    checkedAt: new Date().toISOString(),
    stage,
    schemas: results.map(({ schema, status, code }) => ({ schema, status, code })),
    exposedSchemas: exposedList(unknown),
    graphql: { status: graphql.status, answered: Boolean(graphql.body?.data) },
    auth: {
      status: settings.status,
      mailerAutoconfirm: settings.body?.mailer_autoconfirm ?? null,
      anonymousUsers: settings.body?.external?.anonymous_users ?? null,
    },
  };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  // The platform defaults (public, graphql_public) hold no application objects
  // before cutover; from cutover only api may be exposed.
  for (const result of results.filter((r) => r.schema !== "api"))
    if (stage === "cutover" || ["private", "internal"].includes(result.schema))
      assert.equal(exposed(result), false, `${result.schema} must not be exposed`);
  assert.equal(exposed(results[0]), stage === "cutover", "api exposure does not match the stage");
  assert.equal(exposed(unknown), false, "a schema that cannot exist must be refused (PGRST106)");
  if (stage === "cutover") {
    if (report.exposedSchemas === null)
      throw new Inconclusive("the gateway's refusal did not list the exposed schemas");
    assert.deepEqual(report.exposedSchemas, ["api"], "only api may be exposed");
  }
  assert.equal(report.graphql.answered, false, "GraphQL must stay off");
  assert.equal(report.auth.status, 200, "Auth settings must be readable");
  assert.equal(
    report.auth.mailerAutoconfirm,
    false,
    "Auth must not confirm addresses or email changes without a link (mailer_autoconfirm)"
  );
  assert.equal(report.auth.anonymousUsers, false, "Auth must not allow anonymous sign-ins");
  process.stdout.write(`PASS ${stage}: exposure matches the reviewed policy\n`);
} catch (error) {
  if (!(error instanceof Inconclusive)) throw error;
  process.stderr.write(`INCONCLUSIVE: ${error.message}. Nothing was judged exposed; run again.\n`);
  process.exit(3);
}
