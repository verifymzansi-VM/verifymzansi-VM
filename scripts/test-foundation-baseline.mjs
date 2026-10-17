import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { assertUnreleasedBaselineGuard } from "./lib/foundation-baseline-guard.mjs";

// A rollback-only check of two draft changes, NOT an empty-baseline replay.
let release;
let record = {
  recordedAt: new Date().toISOString(),
  status: "INCOMPLETE",
  productionMutations: [],
};
try {
  assert.equal(process.argv.length, 2);
  const { env, dockerArgs, workdir } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "test");
  const sql = (query) =>
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
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { env, input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    ).trim();
  assert.equal(sql("select count(*) from auth.users;"), "0");
  const assembly = JSON.parse(readFileSync("database/foundation/assembly.json", "utf8"));
  assert.equal(assembly.releaseReady, false);
  assert.match(
    assembly.cliGeneratedMigration,
    /^supabase\/migrations\/\d{14}_unreleased_foundation\.sql$/
  );
  assertFixturePath(process.cwd(), `database/foundation/${assembly.cliGeneratedMigration}`, {
    type: "file",
  });
  const digest = (value) => createHash("sha256").update(value).digest("base64url");
  const candidate = readFileSync("database/foundation/candidate.sql", "utf8");
  assert.equal(digest(candidate), assembly.candidateHash);
  const evidence = JSON.parse(readFileSync(assembly.sourceEvidence, "utf8"));
  assert.equal(digest(readFileSync(assembly.sourceEvidence)), assembly.evidenceHash);
  assert.equal(evidence.status, "PASS");
  for (const [file, hash] of Object.entries(assembly.sourceHashes))
    assert.equal(digest(readFileSync(file)), hash);
  const definitions = [
    ...candidate.matchAll(
      /create function internal\.validate_listing_attributes\([^;]+?as \$\$[\s\S]*?\$\$;/g
    ),
  ];
  assert.equal(definitions.length, 1);
  const definition = definitions[0][0].replace("create function", "create or replace function");
  const gate = readFileSync(`database/foundation/${assembly.cliGeneratedMigration}`, "utf8");
  assertUnreleasedBaselineGuard(gate);
  assert.equal(digest(gate), assembly.deploymentGuardHash);
  const quoted = gate.replaceAll("'", "''");
  sql(`begin;
    do $assert$ declare blocked boolean:=false; begin
      begin execute '${quoted}'; exception when raise_exception then
        if sqlerrm='Unreleased foundation draft: G1 and BF-09 gates are incomplete' then blocked:=true; else raise; end if;
      end;
      if not blocked then raise exception 'Deployment guard did not block'; end if;
    end $assert$;
    ${definition}
    do $assert$ begin
      if internal.validate_listing_attributes('electronics','{}',false)<>'{}'::jsonb then raise exception 'Real draft category failed'; end if;
      begin perform internal.validate_listing_attributes('fixture_market','{}',false); raise exception 'Fixture category accepted';
      exception when invalid_parameter_value then null; end;
    end $assert$;
    rollback;`);
  const functions = JSON.parse(
    sql(
      "select json_agg(json_build_object('name',n.nspname||'.'||p.proname,'body',p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('api','internal');"
    )
  );
  const expected = new Map(evidence.appliedFunctions.map((fn) => [fn.name, fn.bodyHash]));
  assert.equal(functions.length, expected.size);
  for (const fn of functions) assert.equal(digest(fn.body), expected.get(fn.name));
  record = {
    recordedAt: new Date().toISOString(),
    status: "PASS bounded native transaction proof",
    fixture: "backend-foundation-impl",
    baselineReplay:
      "NOT_RUN by this transaction-only command; see separate recorded empty SQL/HTTP proof",
    deploymentGuard: "PASS expected exception; no DDL applied",
    strictDerivedValidator: "PASS real electronics draft accepts; fixture_market rejects22023",
    prototypeFunctionsRestored: functions.length,
    authUsers: 0,
    candidateHash: assembly.candidateHash,
    preservedAssemblyFailures: [
      "Leftover fixture validator blocked initial assembly",
      "CRLF normalization changed body hashes; fixed by preserving bytes",
      "Unsupported fixture operation label rejected before any SQL; reused the existing test operation fence",
    ],
    productionMutations: [],
  };
} catch {
  record.status = "FAIL";
  process.stderr.write(
    "Bounded baseline proof failed; SQL, credentials and environment withheld.\n"
  );
  process.exitCode = 1;
} finally {
  try {
    release?.();
    record.fixtureOperationLock = release ? "PASS released" : "NOT_ACQUIRED";
  } catch {
    record.fixtureOperationLock = "INCOMPLETE release failed";
    record.status = "INCOMPLETE";
    process.stderr.write("Fixture lock release failed.\n");
    process.exitCode = 1;
  }
}
const evidencePath = `docs/backend-foundation/evidence/baseline-preparation-${record.recordedAt.replaceAll(":", "-")}.json`;
writeFileSync(evidencePath, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ ...record, evidencePath }) + "\n");
