// plpgsql_check lint of the replayed foundation schema in a throwaway local
// Postgres container (the Supabase Postgres image, which ships plpgsql_check).
//
// Safety: the container is started by this module with `--network none` and
// reached only through `docker exec` on its own Unix socket. No connection
// string, host or port is accepted, and the PG* environment of the caller is
// never passed in, so it cannot be pointed at a hosted project.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FOUNDATION_DIR } from "./foundation-replay.mjs";

/** Same Postgres major and plpgsql_check as Supabase production (CLI 2.120.0 local image). */
export const LINT_IMAGE =
  "public.ecr.aws/supabase/postgres:17.11.0.004@sha256:b15d862126dd2dac02da524696ccfde2dcce2ceaee0a58973b2727befe492706"; // secret-scan: allow public image digest
export const LINT_BASELINE_FILE = `${FOUNDATION_DIR}/lint-baseline.json`;
export const LINT_STUBS_FILE = `${FOUNDATION_DIR}/replay/lint-platform-stubs.sql`;
const CONTAINER_LABEL = "verifymzansi.foundation-sql-lint=1";

/** Refuses a Docker daemon that is not on this machine. */
export function assertLocalDocker(env = process.env) {
  const host = env.DOCKER_HOST;
  if (!host) return;
  if (/^(unix|npipe):\/\//.test(host)) return;
  if (/^tcp:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(host)) return;
  throw new Error(`Refusing to lint through a non-local Docker daemon (DOCKER_HOST=${host}).`);
}

function docker(args, { input, allowFailure = false, timeout = 600_000 } = {}) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
  if (result.error) throw new Error(`docker ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`docker ${args[0]} exited ${result.status}: ${result.stderr.trim()}`);
  }
  return result;
}

/**
 * `docker run` arguments for the lint database: no network (not even a
 * published port), data and init folders in memory, Supabase's own init
 * scripts and the supautils hook disabled (the replay prelude provides the
 * platform roles), and durability off because the database is thrown away.
 */
export function lintContainerArgs(name, password) {
  return [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--label",
    CONTAINER_LABEL,
    "--network",
    "none",
    "--tmpfs",
    "/docker-entrypoint-initdb.d",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    "POSTGRES_USER=postgres",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    LINT_IMAGE,
    "postgres",
    "-D",
    "/etc/postgresql",
    "-c",
    "shared_preload_libraries=plpgsql_check",
    "-c",
    "session_preload_libraries=",
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "full_page_writes=off",
  ];
}

/**
 * Starts the ephemeral lint database and returns
 * { name, psql(sql, extraArgs), json(sql), stop() }.
 */
export async function startLintDatabase({ log = () => {} } = {}) {
  assertLocalDocker();
  const name = `vm-foundation-sql-lint-${randomBytes(4).toString("hex")}`;
  log(`Starting ${name} from ${LINT_IMAGE.split("@")[0]} ...`);
  docker(lintContainerArgs(name, randomBytes(18).toString("base64url")), { timeout: 900_000 });
  const stop = () => docker(["rm", "--force", name], { allowFailure: true, timeout: 60_000 });
  try {
    // The entrypoint's temporary init server listens only on its socket, so a
    // TCP answer on the container's own loopback means the final server is up.
    const deadline = Date.now() + 120_000;
    for (;;) {
      const ready = docker(
        ["exec", name, "pg_isready", "-q", "-h", "127.0.0.1", "-U", "postgres"],
        {
          allowFailure: true,
          timeout: 30_000,
        }
      );
      if (ready.status === 0) break;
      if (Date.now() > deadline) throw new Error(`${name} did not become ready`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    stop();
    throw error;
  }
  const psql = (sql, extra = []) =>
    docker(
      [
        "exec",
        "-i",
        name,
        "psql",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
        ...extra,
      ],
      { input: sql, allowFailure: true }
    );
  const json = async (sql) => {
    const result = psql(`set search_path to pg_catalog;\n${sql};\n`, ["-A", "-t"]);
    if (result.status !== 0) throw new Error(`Catalogue query failed: ${result.stderr.trim()}`);
    return JSON.parse(result.stdout);
  };
  return { name, psql, json, stop };
}

/**
 * Applies replay steps in one psql session; on failure names the step. Each
 * step is preceded by a marker so the last marker printed is the failing step.
 */
export function applySteps(database, steps) {
  const marker = "@@foundation-replay-step ";
  const stream = steps.map((step) => `\\echo '${marker}${step.label}'\n${step.sql}\n`).join("");
  const result = database.psql(stream);
  if (result.status !== 0) {
    const label = result.stdout
      .split("\n")
      .filter((line) => line.startsWith(marker))
      .at(-1)
      ?.slice(marker.length);
    throw new Error(`Replay failed at ${label ?? "an unknown step"}: ${result.stderr.trim()}`);
  }
}

/**
 * Every non-extension plpgsql function in the foundation schemas, with each
 * trigger function checked against every table it is attached to. Event
 * trigger functions are checked without a relation.
 */
export const LINT_QUERY = `
with fns as (
  select p.oid, p.prorettype
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where l.lanname = 'plpgsql' and n.nspname in ('api', 'internal', 'private', 'public')
    and not exists (select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
),
targets as (
  select f.oid, 0::oid as relid from fns f where f.prorettype <> 'trigger'::regtype
  union
  select f.oid, t.tgrelid from fns f join pg_trigger t on t.tgfoid = f.oid
  where f.prorettype = 'trigger'::regtype
)
select json_build_object(
  'functions', (select count(*) from fns),
  'unattachedTriggers', coalesce((select json_agg(f.oid::regprocedure::text order by f.oid::regprocedure::text collate "C")
    from fns f where f.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_trigger t where t.tgfoid = f.oid)), '[]'::json),
  'targets', coalesce((select json_agg(json_build_object(
      'function', t.oid::regprocedure::text, 'relation', t.relid::regclass::text)) from targets t), '[]'::json),
  'findings', coalesce((select json_agg(json_build_object(
      'function', t.oid::regprocedure::text,
      'relation', t.relid::regclass::text,
      'level', c.level,
      'sqlstate', c.sqlstate,
      'message', c.message,
      'line', c.lineno
    ))
    from targets t,
    lateral extensions.plpgsql_check_function_tb(t.oid, t.relid,
      fatal_errors => false, other_warnings => true, extra_warnings => true,
      performance_warnings => false, security_warnings => true) c), '[]'::json)
)`;

const byBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (finding) =>
  JSON.stringify([finding.function, finding.level, finding.sqlstate, finding.message]);

/**
 * Folds raw plpgsql_check rows into { function, level, sqlstate, message,
 * count, lines }. A trigger function attached to several tables is often
 * written for all of them (branches on TG_TABLE_NAME), so checking it against
 * one table reports fields that exist only on another. A finding counts only
 * when it is reported for every table the function is attached to.
 */
export function collapseFindings(raw) {
  const relationsByFunction = new Map();
  for (const target of raw.targets) {
    const set = relationsByFunction.get(target.function) ?? new Set();
    set.add(target.relation);
    relationsByFunction.set(target.function, set);
  }
  const perRelation = new Map();
  for (const finding of raw.findings) {
    const key = keyOf(finding);
    const entry = perRelation.get(key) ?? { finding, counts: new Map(), lines: new Set() };
    entry.counts.set(finding.relation, (entry.counts.get(finding.relation) ?? 0) + 1);
    if (finding.line !== null) entry.lines.add(finding.line);
    perRelation.set(key, entry);
  }
  const collapsed = [];
  for (const { finding, counts, lines } of perRelation.values()) {
    const relations = relationsByFunction.get(finding.function) ?? new Set(["-"]);
    const count = Math.min(...[...relations].map((relation) => counts.get(relation) ?? 0));
    if (count === 0) continue;
    collapsed.push({
      function: finding.function,
      level: finding.level,
      sqlstate: finding.sqlstate,
      message: finding.message,
      count,
      lines: [...lines].sort((a, b) => a - b),
    });
  }
  for (const fn of raw.unattachedTriggers) {
    collapsed.push({
      function: fn,
      level: "error",
      sqlstate: "VM001",
      message: "trigger function is not attached to any table, so plpgsql_check cannot check it",
      count: 1,
      lines: [],
    });
  }
  return collapsed.sort((a, b) => byBytes(keyOf(a), keyOf(b)));
}

export function readLintBaseline(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, LINT_BASELINE_FILE), "utf8"));
}

/**
 * Compares findings with the reviewed baseline. Errors fail unless listed with
 * a reason in `knownErrors`; warnings fail when they exceed `warnings`. A
 * baseline entry that no longer occurs also fails, so the baseline can only
 * shrink and always describes today's schema.
 */
export function compareLint(findings, baseline) {
  const problems = [];
  const allowed = new Map();
  for (const entry of [...baseline.knownErrors, ...baseline.warnings]) {
    allowed.set(keyOf({ ...entry, level: entry.level ?? "error" }), entry);
  }
  const seen = new Set();
  for (const finding of findings) {
    const key = keyOf(finding);
    seen.add(key);
    const entry = allowed.get(key);
    const limit = entry ? (entry.count ?? 1) : 0;
    const where = `${finding.function} line ${finding.lines.join(",") || "-"}`;
    if (finding.count > limit) {
      problems.push(
        `new ${finding.level}: ${where}: ${finding.message} (${finding.sqlstate}) x${finding.count}, baseline ${limit}`
      );
    } else if (finding.count < limit) {
      problems.push(
        `fixed (shrink the baseline): ${where}: ${finding.message} now x${finding.count}, baseline ${limit}`
      );
    }
  }
  for (const [key, entry] of allowed) {
    if (!seen.has(key)) {
      problems.push(
        `fixed (shrink the baseline): ${entry.function}: ${entry.message} no longer reported`
      );
    }
  }
  return problems;
}

/**
 * The next baseline: today's warnings, refusing growth unless `acceptNew`.
 * Known errors are never added automatically; fixed ones are dropped.
 */
export function nextLintBaseline(findings, baseline, { acceptNew = false } = {}) {
  const errorKeys = new Set(findings.filter((f) => f.level === "error").map(keyOf));
  const knownErrors = baseline.knownErrors.filter((entry) =>
    errorKeys.has(keyOf({ ...entry, level: "error" }))
  );
  const knownErrorKeys = new Set(knownErrors.map((entry) => keyOf({ ...entry, level: "error" })));
  const unknownErrors = findings.filter(
    (f) => f.level === "error" && !knownErrorKeys.has(keyOf(f))
  );
  if (unknownErrors.length > 0) {
    throw new Error(
      `Refusing to record new errors in the baseline; fix them or add each to knownErrors with a reason:\n${unknownErrors
        .map((f) => `  - ${f.function}: ${f.message}`)
        .join("\n")}`
    );
  }
  const previous = new Map(baseline.warnings.map((entry) => [keyOf(entry), entry.count]));
  const warnings = [];
  for (const finding of findings) {
    if (finding.level === "error") continue;
    const before = previous.get(keyOf(finding)) ?? 0;
    if (finding.count > before && !acceptNew) {
      throw new Error(
        `Refusing to grow the baseline (${finding.function}: ${finding.message}); fix the warning or rerun with --accept-new after review.`
      );
    }
    warnings.push({
      function: finding.function,
      level: finding.level,
      sqlstate: finding.sqlstate,
      message: finding.message,
      count: finding.count,
    });
  }
  return { ...baseline, knownErrors, warnings };
}
