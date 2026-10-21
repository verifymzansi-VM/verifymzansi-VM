import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { assertUnreleasedBaselineGuard } from "./lib/foundation-baseline-guard.mjs";
import { generateCleanApiContracts } from "./lib/foundation-api-contracts.mjs";
import { proveBaselineHttp } from "./lib/foundation-baseline-http.mjs";
import { readPostingTermsCatalogue } from "./lib/foundation-posting-terms-catalogue.mjs";

// SQL, scoped HTTP and generated-contract feasibility in a fresh owned local database.
// This does not prove target GoTrue/CLI deployment or bypass the guarded migration.
const recordedAt = new Date().toISOString();
const result = { recordedAt, status: "INCOMPLETE", releaseReady: false, productionMutations: [] };
const database = "foundation_baseline_replay";
let release, sql, createdOid;
let databaseCreated = false;
let stage = "preflight";
try {
  assert.equal(process.argv.length, 2);
  const { env, dockerArgs, workdir, cliPath } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "test");
  const exec = (args, input) =>
    execFileSync(
      "docker",
      [...dockerArgs, "exec", "-i", "supabase_db_backend-foundation-impl", ...args],
      {
        env,
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    ).trim();
  sql = (query, target = "postgres") =>
    exec(
      [
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
      query
    );
  assert.equal(sql("select count(*) from auth.users;"), "0");
  assert.equal(
    sql(`select count(*) from pg_database where datname='${database}';`),
    "0",
    "Existing database must be inspected, not reused or deleted"
  );
  const help = exec(["pg_dump", "--help"]);
  for (const flag of ["--schema-only", "--no-owner", "--no-privileges"])
    assert.ok(help.includes(flag));
  for (const file of ["assembly.json", "candidate.sql"])
    assertFixturePath(process.cwd(), `database/foundation/${file}`, { type: "file" });
  const manifest = JSON.parse(readFileSync("database/foundation/assembly.json", "utf8"));
  assert.equal(manifest.releaseReady, false);
  assert.match(
    manifest.cliGeneratedMigration,
    /^supabase\/migrations\/\d{14}_unreleased_foundation\.sql$/
  );
  assertFixturePath(process.cwd(), `database/foundation/${manifest.cliGeneratedMigration}`, {
    type: "file",
  });
  const guard = readFileSync(`database/foundation/${manifest.cliGeneratedMigration}`, "utf8");
  assertUnreleasedBaselineGuard(guard);
  const hash = (value) => createHash("sha256").update(value).digest("base64url");
  result.toolingProvenance = Object.fromEntries(
    [
      "scripts/replay-foundation-baseline.mjs",
      "scripts/lib/foundation-baseline-http.mjs",
      "scripts/lib/foundation-baseline-auth.mjs",
      "scripts/lib/foundation-baseline-container.mjs",
      "scripts/lib/foundation-api-contracts.mjs",
      "scripts/lib/foundation-api-openapi.mjs",
      "scripts/lib/foundation-posting-terms-catalogue.mjs",
    ].map((file) => [file, hash(readFileSync(file))])
  );
  assertFixturePath(process.cwd(), "database/foundation/catalogue-identities.json", {
    type: "file",
  });
  const identityBytes = readFileSync("database/foundation/catalogue-identities.json");
  assert.equal(hash(identityBytes), manifest.catalogueSeedIdentitiesHash);
  assert.deepEqual(JSON.parse(identityBytes), manifest.catalogueSeedIdentities);
  const postingTerms = readPostingTermsCatalogue();
  assert.deepEqual(postingTerms, manifest.postingTermsCatalogue);
  assert.equal(hash(guard), manifest.deploymentGuardHash);
  const candidate = readFileSync("database/foundation/candidate.sql", "utf8");
  assert.equal(hash(candidate), manifest.candidateHash);
  for (const [file, digest] of Object.entries(manifest.sourceHashes))
    assert.equal(hash(readFileSync(file)), digest);
  stage = "copy Auth definitions only";
  const authDump = exec([
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--schema-only",
    "--schema=auth",
  ]);
  // The candidate owns its triggers on Auth tables and recreates them; the
  // component copy must not reference application schemas that do not exist yet.
  const applicationTriggers = [
    ...authDump.matchAll(/^CREATE TRIGGER .+ EXECUTE FUNCTION internal\.\w+\(\);\n/gm),
  ];
  assert.deepEqual(
    applicationTriggers.map(([line]) => line.trim()),
    [
      "CREATE TRIGGER create_account_profile AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION internal.create_account_profile();",
    ]
  );
  const authSchema = applicationTriggers.reduce((dump, [line]) => dump.replace(line, ""), authDump);
  assert.equal(/\binternal\./.test(authSchema), false);
  result.authSchemaOnlyHash = hash(authSchema);
  result.candidateHash = manifest.candidateHash;
  stage = "create empty owned database";
  sql(`create database ${database} template template0;`);
  databaseCreated = true;
  createdOid = sql(`select oid from pg_database where datname='${database}';`);
  assert.match(createdOid, /^\d+$/);
  stage = "extensions";
  sql(
    'create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions;',
    database
  );
  stage = "Auth schema definitions";
  // Restore the local CLI Auth component's own owners/ACLs, not customer data.
  // The ordinary postgres role cannot reassign reserved component ownership.
  assert.equal(sql("select rolsuper from pg_roles where rolname='supabase_admin';"), "t");
  assert.equal(sql(`select oid from pg_database where datname='${database}';`), createdOid);
  exec(
    [
      "psql",
      "-XqAt",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
    ],
    authSchema
  );
  stage = "Auth component migration metadata only";
  const authMigrations = exec([
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--data-only",
    "--table=auth.schema_migrations",
    "--no-owner",
    "--no-privileges",
  ]);
  exec(
    [
      "psql",
      "-XqAt",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
    ],
    authMigrations
  );
  result.authSystemMetadata = {
    scope: "Same local CLI image's Auth migration ledger only; zero accounts/sessions",
    rows: Number(sql("select count(*) from auth.schema_migrations;", database)),
    hash: hash(authMigrations),
  };
  stage = "candidate DDL";
  sql(candidate, database);
  stage = "function bodies and grants";
  const functions = JSON.parse(
    sql(
      "select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc,'owner',r.rolname,'public_execute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname in('api','internal');",
      database
    )
  );
  const expected = new Map(
    [
      ...candidate.matchAll(
        /create (?:or replace )?function ([\w.]+)\([^;]+?as \$\$([\s\S]*?)\$\$;/g
      ),
    ].map((m) => [m[1], hash(m[2])])
  );
  assert.equal(functions.length, manifest.functions);
  assert.equal(functions.length, expected.size);
  for (const fn of functions) {
    assert.equal(fn.owner, "postgres");
    assert.equal(fn.public_execute, false);
    assert.equal(hash(fn.body), expected.get(fn.name));
  }
  stage = "private RLS and table privileges";
  assert.equal(
    sql(
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' and p.proname in('grant_intro_trial','record_identity_ban');",
      database
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='internal' and p.proname in('grant_intro_trial','record_identity_ban') and has_function_privilege(r,p.oid,'execute');",
      database
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in('r','p') and not c.relrowsecurity;",
      database
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and c.relkind in('r','p','v') and has_table_privilege(r,c.oid,'select,insert,update,delete,truncate,references,trigger');",
      database
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from private.post_category_contracts where category_key like 'fixture%';",
      database
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from pg_tables where schemaname='private' and tablename like 'transport%';",
      database
    ),
    "0"
  );
  stage = "anonymous catalogue parity";
  const catalogue = JSON.parse(
    sql("begin;set local role anon;select api.billing_catalogue();rollback;", database)
  );
  const sourceCatalogue = JSON.parse(sql("select api.billing_catalogue();"));
  const terms = (data) =>
    Object.fromEntries(
      Object.entries(data).map(([key, rows]) => [key, rows.map(({ id: _id, ...row }) => row)])
    );
  assert.deepEqual(terms(catalogue), terms(sourceCatalogue));
  for (const [kind, table, key] of [
    ["plans", "plan_versions", "plan_code"],
    ["addons", "addon_versions", "kind"],
  ]) {
    const actual = JSON.parse(
      sql(
        `select jsonb_object_agg(${key}||'@'||version::text,id::text) from private.${table};`,
        database
      )
    );
    assert.deepEqual(actual, manifest.catalogueSeedIdentities[kind]);
  }
  stage = "immutable posting terms reference seed without account data";
  const seededDocuments = JSON.parse(
    sql(
      "select jsonb_agg(jsonb_build_object('version',version,'document_hash',document_hash) order by version) from private.posting_terms_versions;",
      database
    )
  );
  assert.deepEqual(
    seededDocuments,
    [...postingTerms.documents].sort((a, b) => a.version.localeCompare(b.version))
  );
  assert.equal(sql("select count(*) from private.posting_terms_current;", database), "1");
  assert.equal(
    sql("select version from private.posting_terms_current;", database),
    postingTerms.activeVersion
  );
  assert.equal(sql("select count(*) from private.posting_terms_acceptances;", database), "0");
  result.postingTermsReferenceSeed = {
    status: "PASS exact published versions/hash and one current version; zero account acceptances",
    activeVersion: postingTerms.activeVersion,
    documents: postingTerms.documents,
    sourceHashes: postingTerms.sourceHashes,
  };
  assert.equal(sql("select count(*) from auth.users;", database), "0");
  stage = "clean API types and role manifest";
  result.apiContracts = generateCleanApiContracts({
    sql,
    database,
    env,
    cliPath,
    workdir,
    candidateHash: manifest.candidateHash,
  });
  stage = "fresh baseline HTTP schema and role surface";
  result.httpProof = await proveBaselineHttp({
    env,
    dockerArgs,
    database,
    expectedCatalogue: catalogue,
    candidateHash: manifest.candidateHash,
    sql,
  });
  assert.ok(result.httpProof.status.startsWith("PASS"));
  result.status = "PASS empty-database SQL, scoped PostgREST and fresh local GoTrue feasibility";
  result.functions = functions.length;
  result.catalogueCounts = { plans: catalogue.plans.length, addons: catalogue.addons.length };
  result.fixedCatalogueIdentities = "PASS all20 fixed new-target identifiers match manifest";
  result.catalogueSeedIdentitiesHash = manifest.catalogueSeedIdentitiesHash;
  result.rlsAndPrivateTableGrants = "PASS";
  result.demoObjectsAbsent = true;
  result.rawIdentityApisAbsent =
    "PASS no raw API names/overloads; raw internal core has no client or service execute";
  result.authUserDataCopied = false;
  result.fullCliAuthPostgrestReplay =
    "INCOMPLETE: local component ownership, fresh GoTrue sessions and mapped PostgREST proven; hosted ES256 keys, gateway, signup delivery/callbacks and full application acceptance remain";
} catch (error) {
  result.status = "FAIL";
  result.stage = stage;
  result.sqlState = String(error.stderr ?? "").match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? null;
  process.exitCode = 1;
} finally {
  try {
    if (result.httpProof?.httpContainerCleanup?.startsWith("INCOMPLETE"))
      throw new Error("Preserve database until exact owned HTTP container cleanup is confirmed");
    if (result.httpProof?.authProof?.authContainerCleanup?.startsWith("INCOMPLETE"))
      throw new Error("Preserve database until exact owned Auth container cleanup is confirmed");
    if (databaseCreated && createdOid === undefined)
      throw new Error("Database created without verified identity; preserve for inspection");
    if (createdOid !== undefined) {
      assert.equal(sql(`select oid from pg_database where datname='${database}';`), createdOid);
      sql(`drop database ${database};`); // No FORCE; never remove a pre-existing database.
    }
    result.temporaryDatabaseCleanup =
      createdOid === undefined ? "NOT_CREATED" : "PASS owned database removed";
  } catch {
    result.temporaryDatabaseCleanup = "INCOMPLETE; inspect foundation_baseline_replay";
    result.status = "INCOMPLETE";
    process.exitCode = 1;
  }
  try {
    release?.();
    result.fixtureOperationLock = release ? "PASS released" : "NOT_ACQUIRED";
  } catch {
    result.fixtureOperationLock = "INCOMPLETE";
    result.status = "INCOMPLETE";
    process.exitCode = 1;
  }
}
const evidencePath = `docs/backend-foundation/evidence/baseline-empty-sql-${recordedAt.replaceAll(":", "-")}.json`;
assertFixturePath(process.cwd(), evidencePath, { allowMissing: true, type: "file" });
writeFileSync(evidencePath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ ...result, evidencePath }) + "\n");
