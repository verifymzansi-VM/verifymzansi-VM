// Read-only probe of the hosted London Data API exposure, using only the public
// publishable key. It never signs in, writes, or reads application rows.
//
//   node scripts/check-foundation-hosted-exposure.mjs --stage=pre-cutover|cutover
//
// Reads FOUNDATION_SUPABASE_URL and FOUNDATION_SUPABASE_PUBLISHABLE_KEY.
// Always: private and internal are not exposed and GraphQL answers no queries.
// Before cutover api is not exposed either; at cutover it is the only exposed
// schema.
import assert from "node:assert/strict";

const stage = process.argv.find((arg) => arg.startsWith("--stage="))?.slice(8);
assert.ok(["pre-cutover", "cutover"].includes(stage ?? ""), "Pass --stage=pre-cutover|cutover");
const url = new URL(process.env.FOUNDATION_SUPABASE_URL ?? "");
assert.equal(url.protocol, "https:");
assert.match(url.hostname, /^gntzjtuncsyefujajmjy\.supabase\.co$/);
const key = process.env.FOUNDATION_SUPABASE_PUBLISHABLE_KEY ?? "";
assert.match(key, /^sb_publishable_[A-Za-z0-9_-]+$/);

const probe = async (schema) => {
  // The schema check runs before function lookup, so an unexposed schema
  // answers PGRST106 whatever the name; api's anon-callable terms read is used.
  const response = await fetch(new URL("/rest/v1/rpc/get_current_posting_terms", url), {
    method: "POST",
    headers: {
      apikey: key,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      "Accept-Profile": schema,
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null);
  return { schema, status: response.status, code: body?.code ?? null };
};
const exposed = (result) => result.status !== 406 || result.code !== "PGRST106";
const results = [];
for (const schema of ["api", "private", "internal", "public", "graphql_public"])
  results.push(await probe(schema));
const graphql = await fetch(new URL("/graphql/v1", url), {
  method: "POST",
  headers: { apikey: key, "Content-Type": "application/json" },
  body: JSON.stringify({ query: "{ __typename }" }),
  redirect: "error",
  signal: AbortSignal.timeout(10000),
});
const graphqlBody = await graphql.json().catch(() => null);
const report = {
  checkedAt: new Date().toISOString(),
  stage,
  schemas: results,
  graphql: { status: graphql.status, answered: Boolean(graphqlBody?.data) },
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");

// The platform defaults (public, graphql_public) hold no application objects
// before cutover; from cutover only api may be exposed.
for (const result of results.filter((r) => r.schema !== "api"))
  if (stage === "cutover" || ["private", "internal"].includes(result.schema))
    assert.equal(exposed(result), false, `${result.schema} must not be exposed`);
assert.equal(exposed(results[0]), stage === "cutover", "api exposure does not match the stage");
assert.equal(report.graphql.answered, false, "GraphQL must stay off");
process.stdout.write(`PASS ${stage}: exposure matches the reviewed policy\n`);
