#!/usr/bin/env node
// Behaviour checks for 20261111234521_public_default_privileges.sql: no
// default rights for anon, authenticated and service_role on new objects that
// postgres creates in schema public.
//
// Part 1 replays database/foundation (prelude, candidate.sql, every update
// before this one) into the throwaway, network-less Postgres 17 container of
// the SQL lint gate, and gives postgres and supabase_admin the default
// privileges in public that production had in the read-only catalogue capture
// of 6 November 2026 (the lint container starts without Supabase's start-up
// scripts, so it has none). It then checks that the preflight is read only and
// recognises that state, that the update withdraws exactly postgres's rights
// for the three roles, that a table, sequence and function postgres creates in
// public afterwards give them nothing (and before the update did), that the
// rollback restores the captured rows byte for byte and refuses any other
// state, that the update refuses when global defaults would still reach
// public, and that apply -> rollback -> apply returns the same default ACLs and
// schema fingerprint each time.
//
// Part 2 starts a second throwaway container from the same image WITH
// Supabase's own start-up scripts and its supautils hook (as on the hosted
// project, postgres is not a superuser there and is not a member of
// supabase_admin) and runs the preflight, the update and the rollback as
// postgres: the update and the rollback are allowed, while changing
// supabase_admin's defaults is refused, which is why those stay.
//
//   node --import tsx scripts/test-foundation-public-default-privileges.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import {
  LINT_IMAGE,
  applySteps,
  assertLocalDocker,
  startLintDatabase,
} from "./lib/foundation-sql-lint.mjs";

const UPDATE = "20261111234521_public_default_privileges.sql";
const companion = (folder, suffix) =>
  readFileSync(`database/foundation/${folder}/${UPDATE.replace(/\.sql$/, suffix)}`, "utf8");
const PREFLIGHT = companion("preflight", ".check.sql");
const ROLLBACK = companion("rollback", ".down.sql");
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const ROLES = "anon, authenticated, service_role";

/** postgres's rows as production had them (6 November 2026 capture). */
const CAPTURED = [
  "postgres|public|S|{postgres=rwU/postgres,anon=w/postgres,authenticated=w/postgres,service_role=w/postgres}",
  "postgres|public|f|{postgres=X/postgres}",
  "postgres|public|r|{postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=Dxtm/postgres,service_role=Dxtm/postgres}",
];
/** postgres's rows after the update. */
const APPLIED = [
  "postgres|public|S|{postgres=rwU/postgres}",
  "postgres|public|f|{postgres=X/postgres}",
  "postgres|public|r|{postgres=arwdDxtm/postgres}",
];
/** supabase_admin's rows in public, which the update cannot change. */
const SUPABASE_ADMIN = [
  "supabase_admin|public|S|{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}",
  "supabase_admin|public|f|{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}",
  "supabase_admin|public|r|{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}",
];

/** Every default ACL row: "role|schema|kind|acl", sorted. */
const DEFAULT_ACLS = `select coalesce(string_agg(row, E'\\n' order by row collate "C"), '') from (
  select format('%s|%s|%s|%s', pg_get_userbyid(defaclrole),
    case defaclnamespace when 0 then '-' else defaclnamespace::regnamespace::text end,
    defaclobjtype, defaclacl) as row from pg_default_acl) x;`;
/** The roadmap's pass check: default privileges for anon or authenticated in
 * public, per creating role. */
const PASS_CHECK = `select coalesce(string_agg(format('%s:%s', r, n), ',' order by r collate "C"), '') from (
  select pg_get_userbyid(d.defaclrole) r, count(*) n from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
  where d.defaclnamespace = 'public'::regnamespace
    and a.grantee in ('anon'::regrole, 'authenticated'::regrole) group by 1) x;`;
/** What the three roles may do on a table, sequence and function that the
 * current role creates in public (inside a transaction that is rolled back). */
const PROBE = `begin;
create table public.vmtest_probe (id int);
create sequence public.vmtest_probe_seq;
create function public.vmtest_probe_fn() returns int language sql as 'select 1';
select coalesce(string_agg(item, ',' order by item collate "C"), '') from (
  select 'table ' || r || ':' || p as item
    from unnest(array['anon','authenticated','service_role']) r,
         unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
    where has_table_privilege(r, 'public.vmtest_probe', p)
  union all
  select 'sequence ' || r || ':' || p
    from unnest(array['anon','authenticated','service_role']) r, unnest(array['USAGE','SELECT','UPDATE']) p
    where has_sequence_privilege(r, 'public.vmtest_probe_seq', p)
  union all
  select 'function ' || r || ':EXECUTE'
    from unnest(array['anon','authenticated','service_role']) r
    where has_function_privilege(r, 'public.vmtest_probe_fn()', 'EXECUTE')) x;
rollback;`;
const roleItems = (kind, privileges) =>
  ["anon", "authenticated", "service_role"].flatMap((role) =>
    privileges.map((privilege) => `${kind} ${role}:${privilege}`)
  );
const CAPTURED_PROBE = [
  ...roleItems("sequence", ["UPDATE"]),
  ...roleItems("table", ["MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"]),
]
  .sort()
  .join(",");
const FULL_PROBE = [
  ...roleItems("function", ["EXECUTE"]),
  ...roleItems("sequence", ["SELECT", "UPDATE", "USAGE"]),
  ...roleItems("table", [
    "DELETE",
    "INSERT",
    "MAINTAIN",
    "REFERENCES",
    "SELECT",
    "TRIGGER",
    "TRUNCATE",
    "UPDATE",
  ]),
]
  .sort()
  .join(",");

const checks = [];
let current = "start";
async function check(id, fn) {
  current = id;
  await fn();
  checks.push(id);
  console.log(`PASS ${id}`);
}

/** Query helpers for one database handle ({ psql(sql, args) }). */
function helpers(database, user) {
  const args = (extra = []) => (user ? ["-U", user, ...extra] : extra);
  const run = (sql, extra = []) =>
    database.psql(`\\set VERBOSITY verbose\n${sql}`, args(["-A", "-t", ...extra]));
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const refused = (sql, state, message) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, it succeeded`);
    assert.equal(/ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1], state, result.stderr);
    assert.match(result.stderr, message);
  };
  const acls = () => q(DEFAULT_ACLS).split("\n").filter(Boolean);
  const publicAcls = (role) => acls().filter((row) => row.startsWith(`${role}|public|`));
  const preflight = () =>
    q(PREFLIGHT)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  /** The preflight run as one read-only transaction refuses a write after it. */
  const preflightIsReadOnly = () => {
    const write = run(`${PREFLIGHT}\ncreate table private.vmtest_marker(id uuid);`, ["-1"]);
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
  };
  const probe = () => q(PROBE).split("\n").filter(Boolean).join("");
  return { run, q, refused, acls, publicAcls, preflight, preflightIsReadOnly, probe };
}

/** Second throwaway container: the same image with Supabase's own start-up
 * scripts and supautils, no network, reached only through `docker exec`. */
async function startHostedLikeDatabase() {
  assertLocalDocker();
  const docker = (args, input) =>
    spawnSync("docker", args, { input, encoding: "utf8", timeout: 600_000, windowsHide: true });
  const name = `vm-foundation-hostedlike-${randomBytes(4).toString("hex")}`;
  console.log(`Starting ${name} from ${LINT_IMAGE.split("@")[0]} with Supabase start-up ...`);
  const started = docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--label",
    "verifymzansi.foundation-sql-lint=1",
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    `POSTGRES_PASSWORD=${randomBytes(18).toString("base64url")}`,
    LINT_IMAGE,
    "postgres",
    "-D",
    "/etc/postgresql",
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "full_page_writes=off",
  ]);
  if (started.error) throw new Error(`docker run failed: ${started.error.message}`);
  if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);
  const stop = () => docker(["rm", "--force", name]);
  // Supabase's start-up scripts run on a socket-only temporary server; a TCP
  // answer on the container's own loopback means the final server is up.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const ready = docker(["exec", name, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"]);
    if (ready.status === 0) break;
    if (Date.now() > deadline) {
      stop();
      throw new Error(`${name} did not become ready`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const psql = (sql, extra = []) =>
    docker(
      ["exec", "-i", name, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", "postgres", ...extra],
      sql
    );
  return { psql, stop };
}

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
let hosted;
try {
  const { steps } = replaySteps();
  const index = steps.findIndex((step) => step.label === UPDATE);
  assert.ok(index > 0, `${UPDATE} is missing`);
  const step = steps[index];
  applySteps(database, steps.slice(0, index));
  const db = helpers(database);
  const fingerprint = () => db.q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const applyUpdate = () => applySteps(database, [step]);
  const applyRollback = () =>
    applySteps(database, [{ label: "public default privileges rollback", sql: ROLLBACK }]);

  // ------------------------------------------------- production-like start
  // The rows production had, built as production's own were: postgres's own
  // rights first, then the three roles (as Supabase's start-up scripts do).
  db.q(`alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public
  grant truncate, references, trigger, maintain on tables to ${ROLES};
alter default privileges for role postgres in schema public grant update on sequences to ${ROLES};
alter default privileges for role supabase_admin in schema public grant all on tables to postgres, ${ROLES};
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, ${ROLES};
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, ${ROLES};`);
  const original = fingerprint();
  const before = db.acls();

  await check("the production-like start has the captured default privileges", () => {
    assert.deepEqual(db.publicAcls("postgres"), CAPTURED);
    assert.deepEqual(db.publicAcls("supabase_admin"), SUPABASE_ADMIN);
    // candidate.sql's global row: new functions are not executable by PUBLIC.
    assert.ok(before.includes("postgres|-|f|{postgres=X/postgres}"), before.join("\n"));
    assert.equal(db.q(PASS_CHECK), "postgres:10,supabase_admin:24");
    assert.equal(db.probe(), CAPTURED_PROBE);
  });
  await check("before the update a new table in public grants the API roles table rights", () => {
    assert.equal(
      db.q(`begin; create table public.vmtest_probe (id int); insert into public.vmtest_probe values (1);
set local role anon; truncate public.vmtest_probe; reset role;
select count(*) from public.vmtest_probe; rollback;`),
      "0"
    );
  });
  await check("preflight: read only; recognises the captured state", () => {
    const rows = db.preflight();
    assert.deepEqual(
      rows.map((row) => row[0]),
      ["summary", ...Array(9).fill("unchanged")],
      JSON.stringify(rows)
    );
    assert.match(
      rows[0][1],
      /^public default privileges: not applied; matches the production capture of 6 November 2026 .*; objects in public outside extensions: 0 relations, 0 functions$/
    );
    assert.ok(
      rows.some((row) =>
        /^supabase_admin gives DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE to anon on new tables in public/.test(
          row[1]
        )
      )
    );
    db.preflightIsReadOnly();
    assert.deepEqual(db.acls(), before);
    assert.equal(fingerprint(), original);
  });
  await check("a rollback before the update changes nothing", () => {
    applyRollback();
    assert.deepEqual(db.acls(), before);
  });
  await check("global default privileges that reach public make the update refuse", () => {
    db.q(`alter default privileges for role postgres grant select on tables to anon;`);
    assert.match(
      db.preflight().find((row) => row[0] === "problem")?.[1] ?? "",
      /postgres gives SELECT on new tables in all schemas to anon; the update would refuse/
    );
    db.refused(step.sql, "55000", /all schemas tables to anon/);
    db.q(`alter default privileges for role postgres revoke select on tables from anon;`);
    // Without candidate.sql's global row, PUBLIC may execute new functions.
    db.q(`alter default privileges for role postgres grant execute on functions to public;`);
    assert.ok(!db.acls().some((row) => row.startsWith("postgres|-|f|")));
    db.refused(step.sql, "55000", /PUBLIC execute on new functions/);
    db.q(`alter default privileges for role postgres revoke execute on functions from public;`);
    assert.deepEqual(db.acls(), before);
  });

  // ------------------------------------------------------------- apply
  applyUpdate();
  const after = db.acls();
  await check("after the update: no default privileges for the API roles from postgres", () => {
    assert.deepEqual(db.publicAcls("postgres"), APPLIED);
    assert.deepEqual(db.publicAcls("supabase_admin"), SUPABASE_ADMIN, "supabase_admin unchanged");
    // Every other row is unchanged.
    assert.deepEqual(
      after.filter((row) => !row.startsWith("postgres|public|")),
      before.filter((row) => !row.startsWith("postgres|public|"))
    );
    assert.equal(db.q(PASS_CHECK), "supabase_admin:24");
    assert.equal(fingerprint(), original, "no function, table or grant changed");
    const rows = db.preflight();
    assert.deepEqual(
      rows.map((row) => row[0]),
      ["summary", ...Array(9).fill("unchanged")]
    );
    assert.match(rows[0][1], /^public default privileges: already applied; /);
  });
  await check("a table, sequence and function postgres creates in public give them nothing", () => {
    assert.equal(db.probe(), "");
    db.refused(
      `begin; create table public.vmtest_probe (id int); set local role anon; truncate public.vmtest_probe;`,
      "42501",
      /permission denied for table vmtest_probe/
    );
    db.refused(
      `begin; create table public.vmtest_probe (id int); set local role authenticated; select * from public.vmtest_probe;`,
      "42501",
      /permission denied for table vmtest_probe/
    );
    assert.equal(
      db.q(`select count(*) from pg_class where relnamespace = 'public'::regnamespace;`),
      "0"
    );
  });
  await check("running the update again changes nothing", () => {
    applyUpdate();
    assert.deepEqual(db.acls(), after);
  });
  await check("the rollback refuses a state it did not come from; the update does not", () => {
    db.q(
      `alter default privileges for role postgres in schema public grant select on tables to anon;`
    );
    db.refused(
      ROLLBACK,
      "55000",
      /neither the update's nor the production capture: tables anon:SELECT/
    );
    db.q(`alter default privileges for role postgres in schema public revoke select on tables from anon;
alter default privileges for role postgres in schema public
  grant truncate on tables to anon with grant option;`);
    db.refused(ROLLBACK, "55000", /tables anon:TRUNCATE with grant option/);
    // Rights given to PUBLIC reach the three roles too; the update withdraws them.
    db.q(`alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public grant select on tables to public;`);
    assert.match(db.probe(), /table anon:SELECT/);
    db.refused(ROLLBACK, "55000", /tables PUBLIC:SELECT/);
    applyUpdate();
    assert.deepEqual(db.acls(), after);
    assert.equal(db.probe(), "");
    // A fresh local database starts with every privilege; the update still
    // withdraws them all.
    db.q(`alter default privileges for role postgres in schema public grant all on tables to ${ROLES};
alter default privileges for role postgres in schema public grant all on sequences to ${ROLES};
alter default privileges for role postgres in schema public grant all on functions to ${ROLES};`);
    assert.equal(db.probe(), FULL_PROBE);
    assert.match(
      db.preflight().find((row) => row[0] === "problem")?.[1] ?? "",
      /^not applied, and the starting state differs from the production capture: extra functions anon:EXECUTE;/
    );
    db.refused(ROLLBACK, "55000", /neither the update's nor the production capture/);
    applyUpdate();
    assert.deepEqual(db.acls(), after);
  });
  await check("apply -> rollback -> apply gives the same default privileges each time", () => {
    applyRollback();
    assert.deepEqual(db.acls(), before, "the rollback restores the captured rows exactly");
    assert.equal(db.probe(), CAPTURED_PROBE);
    assert.equal(fingerprint(), original);
    assert.match(db.preflight()[0][1], /not applied; matches the production capture/);
    applyRollback();
    assert.deepEqual(db.acls(), before, "a repeated rollback changes nothing");
    applyUpdate();
    assert.deepEqual(db.acls(), after, "re-applying gives the same rows");
    assert.equal(fingerprint(), original);
  });

  const later = steps.slice(index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the withdrawn default privileges", () => {
      assert.deepEqual(db.publicAcls("postgres"), APPLIED);
    });
  }

  // ---------------------------------------- hosted-like roles (supautils)
  hosted = await startHostedLikeDatabase();
  const asPostgres = helpers(hosted, "postgres");
  const asAdmin = helpers(hosted, "supabase_admin");
  await check("hosted-like: postgres is not a superuser nor a member of supabase_admin", () => {
    assert.equal(
      asAdmin.q(`select string_agg(rolname || '=' || rolsuper, ',' order by rolname) from pg_roles
        where rolname in ('postgres', 'supabase_admin');`),
      "postgres=false,supabase_admin=true"
    );
    assert.equal(asAdmin.q(`select pg_has_role('postgres', 'supabase_admin', 'member');`), "f");
    assert.deepEqual(asPostgres.publicAcls("supabase_admin"), SUPABASE_ADMIN);
  });
  await check("hosted-like: as postgres the update clears a fresh database's defaults", () => {
    // candidate.sql's global row, set as postgres; the rest is as Supabase's
    // start-up scripts left it.
    asPostgres.q(`alter default privileges revoke execute on functions from public;`);
    assert.equal(asPostgres.probe(), FULL_PROBE);
    assert.match(asPostgres.preflight()[0][1], /not applied; differs from the production capture/);
    asPostgres.preflightIsReadOnly();
    asPostgres.refused(ROLLBACK, "55000", /neither the update's nor the production capture/);
    asPostgres.q(step.sql);
    assert.deepEqual(asPostgres.publicAcls("postgres"), APPLIED);
    assert.deepEqual(asPostgres.publicAcls("supabase_admin"), SUPABASE_ADMIN);
    assert.equal(asPostgres.q(PASS_CHECK), "supabase_admin:24");
    assert.equal(asPostgres.probe(), "");
  });
  await check("hosted-like: as postgres the rollback restores the capture exactly", () => {
    asPostgres.q(ROLLBACK);
    assert.deepEqual(asPostgres.publicAcls("postgres"), CAPTURED);
    assert.equal(asPostgres.probe(), CAPTURED_PROBE);
    const start = asPostgres.acls();
    assert.match(asPostgres.preflight()[0][1], /not applied; matches the production capture/);
    asPostgres.q(step.sql);
    assert.deepEqual(asPostgres.publicAcls("postgres"), APPLIED);
    asPostgres.q(ROLLBACK);
    assert.deepEqual(asPostgres.acls(), start, "the rollback restores the captured rows exactly");
    asPostgres.q(step.sql);
    assert.deepEqual(asPostgres.publicAcls("postgres"), APPLIED);
  });
  await check("hosted-like: supabase_admin's defaults cannot be changed by postgres", () => {
    asPostgres.refused(
      `alter default privileges for role supabase_admin in schema public revoke all on tables from anon;`,
      "42501",
      /permission denied to change default privileges/
    );
    // What stays: an object supabase_admin creates in public is open to them.
    assert.equal(asAdmin.probe(), FULL_PROBE);
  });
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  hosted?.stop();
  database.stop();
}
console.log(
  `Public default privilege checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
