import assert from "node:assert/strict";
import { cleanupOwnedProbeDatabase } from "./lib/foundation-native-probe-cleanup.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";

assert.equal(process.argv.length, 2);
const database = "foundation_context_ddl_probe",
  result = {
    recordedAt: new Date().toISOString(),
    status: "INCOMPLETE",
    productionMutations: [],
    scope: "Atomic local DDL refusal only; no user rows or Auth definitions copied",
  };
let release,
  sql,
  createdOid,
  creationAttempted = false,
  stage = "preflight";
const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("base64url");
try {
  const { env, dockerArgs, workdir } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "test");
  sql = (query, db = "postgres") =>
    execFileSync(
      "docker",
      [
        ...dockerArgs,
        "exec",
        "-i",
        "supabase_db_backend-foundation-impl",
        "psql",
        "-U",
        "postgres",
        "-d",
        db,
        "-XqAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=verbose",
      ],
      { env, input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    ).trim();
  assert.equal(sql("select count(*) from auth.users;"), "0");
  assert.equal(sql(`select count(*) from pg_database where datname='${database}';`), "0");
  result.provenance = Object.fromEntries(
    [
      "scripts/probe-foundation-context-ddl.mjs",
      "docs/backend-foundation/prototypes/business-event-context.sql",
      "scripts/lib/foundation-native-isolation.mjs",
      "scripts/lib/foundation-native-lock.mjs",
      "scripts/lib/foundation-native-paths.mjs",
      "scripts/lib/foundation-native-probe-cleanup.mjs",
    ].map((file) => [file, digest(file)])
  );
  const columns = JSON.parse(
    sql(
      "select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod)) order by attnum) from pg_attribute where attrelid='private.posts'::regclass and attnum>0 and not attisdropped;"
    )
  );
  for (const c of columns) {
    assert.match(c.name, /^[a-z_][a-z0-9_]*$/);
    assert.ok(
      ["uuid", "text", "integer", "timestamp with time zone", "boolean", "bigint"].includes(c.type)
    );
  }
  result.postColumnShapeHash = createHash("sha256")
    .update(JSON.stringify(columns))
    .digest("base64url");
  stage = "create owned DDL database";
  creationAttempted = true;
  sql(`create database ${database};`);
  createdOid = sql(`select oid from pg_database where datname='${database}';`);
  assert.match(createdOid, /^[1-9][0-9]*$/);
  sql(
    `create schema api;create schema internal;create schema private;
    revoke all on schema api,internal,private from public;
    grant usage on schema api,internal to authenticated;
    create table private.posts (${columns.map((c) => '"' + c.name + '" ' + c.type).join(",")});
    create function internal.apply_post_edit(p_original_id uuid,p_edit_id uuid)
      returns jsonb language sql security invoker set search_path=pg_catalog as $$select '{}'::jsonb;$$;
    revoke all on function internal.apply_post_edit(uuid,uuid) from public,anon,authenticated,service_role;
    create function api.save_business_event_context(p_post_id uuid,p_expected_revision integer,p_patch jsonb)
      returns jsonb language sql security invoker set search_path=pg_catalog as $$select '{}'::jsonb;$$;
    revoke all on function api.save_business_event_context(uuid,integer,jsonb) from public,anon,authenticated,service_role;
    grant execute on function api.save_business_event_context(uuid,integer,jsonb) to authenticated;`,
    database
  );
  const snapshot = () =>
    JSON.parse(
      sql(
        "select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'oid',p.oid,'args',oidvectortypes(p.proargtypes),'defaults',p.pronargdefaults,'acl',p.proacl,'body',p.prosrc,'definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'owner',p.proowner) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','internal');",
        database
      )
    );
  const before = snapshot();
  assert.equal(before.length, 2);
  stage = "API collision after helper replacement and new internal creation";
  let state;
  try {
    sql(
      readFileSync("docs/backend-foundation/prototypes/business-event-context.sql", "utf8"),
      database
    );
  } catch (error) {
    state = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];
  }
  assert.equal(state, "42723");
  assert.deepEqual(snapshot(), before);
  assert.equal(
    sql(
      "select to_regprocedure('internal.save_business_event_context(uuid,integer,jsonb)') is null;",
      database
    ),
    "t"
  );
  assert.equal(sql("select count(*) from private.posts;", database), "0");
  for (const [file, hash] of Object.entries(result.provenance)) assert.equal(digest(file), hash);
  result.status =
    "PASS atomic DDL collision restores old approval and API OIDs/bodies/ACLs; new context helper absent";
  result.sqlState = state;
  result.functionsPreserved = 2;
  result.newInternalAbsent = true;
} catch {
  result.status = "FAIL";
  result.stage = stage;
  process.exitCode = 1;
} finally {
  try {
    result.databaseCleanup = cleanupOwnedProbeDatabase({
      sql,
      database,
      createdOid,
      creationAttempted,
    });
  } catch {
    result.status = "INCOMPLETE";
    result.databaseCleanup = "INCOMPLETE preserve owned probe for inspection";
    process.exitCode = 1;
  }
  try {
    release?.();
    result.lockReleased = true;
  } catch {
    result.status = "INCOMPLETE";
    result.lockReleased = false;
    process.exitCode = 1;
  }
  const file = `docs/backend-foundation/evidence/context-ddl-${result.recordedAt.replaceAll(":", "-")}.json`;
  assertFixturePath(process.cwd(), file, { allowMissing: true, type: "file" });
  writeFileSync(file, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(JSON.stringify({ ...result, evidence: file }) + "\n");
}
