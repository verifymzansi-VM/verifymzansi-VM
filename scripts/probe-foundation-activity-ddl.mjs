import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";

// A minimal DDL-only database proves failed signature replacement leaves the
// original function identities/grants intact. No Auth definitions or user data.
assert.equal(process.argv.length, 2);
const result = {
  recordedAt: new Date().toISOString(),
  status: "INCOMPLETE",
  productionMutations: [],
  scope: "Local DDL rollback only; real Auth/owner authorization is tested separately",
};
const database = "foundation_activity_ddl_probe";
let sql,
  release,
  createdOid,
  creationAttempted = false,
  stage = "fixture identity";
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("base64url");
try {
  const { env, dockerArgs, workdir } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "test");
  sql = (query, target = "postgres") => {
    assert.ok(["postgres", database].includes(target));
    return execFileSync(
      "docker",
      [
        ...dockerArgs,
        "exec",
        "-i",
        "supabase_db_backend-foundation-impl",
        "psql",
        "-XqAt",
        "-U",
        "postgres",
        "-d",
        target,
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      { env, input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  };
  result.provenance = Object.fromEntries(
    [
      "scripts/probe-foundation-activity-ddl.mjs",
      "docs/backend-foundation/prototypes/core-activity-create.sql",
      "scripts/lib/foundation-native-isolation.mjs",
      "scripts/lib/foundation-native-lock.mjs",
      "scripts/lib/foundation-native-paths.mjs",
    ].map((file) => [file, digest(file)])
  );
  assert.equal(sql("select count(*) from auth.users;"), "0");
  assert.equal(
    sql(`select count(*) from pg_database where datname='${database}';`),
    "0",
    "Existing probe database must not be reused or deleted"
  );
  stage = "create owned DDL database";
  creationAttempted = true;
  sql(`create database ${database};`);
  createdOid = sql(`select oid from pg_database where datname='${database}';`);
  assert.match(createdOid, /^[1-9][0-9]*$/);
  sql(
    `create schema api; create schema internal; create schema private;
   revoke all on schema api,internal,private from public;
   grant usage on schema api,internal to authenticated;
   create function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb)
   returns jsonb language sql security definer set search_path=pg_catalog as $$ select '{}'::jsonb; $$;
   revoke all on function internal.create_core_draft(text,text,text,jsonb) from public,anon,authenticated,service_role;
   grant execute on function internal.create_core_draft(text,text,text,jsonb) to authenticated;
   create function api.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb)
   returns jsonb language sql security invoker set search_path=pg_catalog as $$ select internal.create_core_draft(p_kind,p_area,p_category_key,p_detail); $$;
   revoke all on function api.create_core_draft(text,text,text,jsonb) from public,anon,authenticated,service_role;
   grant execute on function api.create_core_draft(text,text,text,jsonb) to authenticated;
   create view private.activity_signature_dependency as select internal.create_core_draft('listing','market','electronics','{}'::jsonb) as value;`,
    database
  );
  const snapshot = () =>
    JSON.parse(
      sql(
        "select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'oid',p.oid,'args',oidvectortypes(p.proargtypes),'defaults',p.pronargdefaults,'acl',p.proacl,'body',p.prosrc,'definer',p.prosecdef,'config',p.proconfig,'owner',p.proowner) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('api','internal');",
        database
      )
    );
  const before = snapshot();
  assert.equal(before.length, 2);
  stage = "dependent-object failure after first DROP";
  let state;
  try {
    sql(
      readFileSync("docs/backend-foundation/prototypes/core-activity-create.sql", "utf8"),
      database
    );
  } catch (error) {
    state = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
  }
  assert.equal(state, "2BP01");
  assert.deepEqual(snapshot(), before);
  assert.equal(
    sql(
      "select to_regprocedure('api.create_core_draft(text,text,text,jsonb,text)') is null and to_regprocedure('internal.create_core_draft(text,text,text,jsonb,text)') is null;",
      database
    ),
    "t"
  );
  for (const [file, hash] of Object.entries(result.provenance)) assert.equal(digest(file), hash);
  result.status = "PASS atomic DDL refusal preserves both old signatures, OIDs, bodies and grants";
  result.sqlState = state;
  result.functionsPreserved = 2;
  result.newOverloadsAbsent = true;
} catch {
  result.status = "FAIL";
  result.stage = stage;
  process.exitCode = 1;
} finally {
  try {
    if (createdOid) {
      assert.equal(sql(`select oid from pg_database where datname='${database}';`), createdOid);
      sql(`drop database ${database};`);
      assert.equal(sql(`select count(*) from pg_database where datname='${database}';`), "0");
      result.databaseCleanup = "PASS owned temporary database removed";
    } else if (creationAttempted) {
      assert.equal(sql(`select count(*) from pg_database where datname='${database}';`), "0");
      result.databaseCleanup = "PASS no database created";
    } else result.databaseCleanup = "NOT_CREATED";
  } catch {
    result.status = "INCOMPLETE";
    result.databaseCleanup = "INCOMPLETE preserve probe for inspection";
    process.exitCode = 1;
  } finally {
    try {
      release?.();
      result.lockReleased = true;
    } catch {
      result.status = "INCOMPLETE";
      result.lockReleased = false;
      process.exitCode = 1;
    }
  }
  const file = `docs/backend-foundation/evidence/activity-ddl-${result.recordedAt.replaceAll(":", "-")}.json`;
  assertFixturePath(process.cwd(), file, { allowMissing: true, type: "file" });
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ ...result, evidence: file }) + "\n");
}
