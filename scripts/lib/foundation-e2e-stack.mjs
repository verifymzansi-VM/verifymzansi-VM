// Throwaway local Supabase stack for the foundation browser test copy (M0.7).
// The stack runs under its own CLI project id (vm-foundation-e2e) in an ignored
// workspace (tmp/foundation-e2e). Its database is built only from
// database/foundation/ (see replayMigrationNames). Nothing here accepts a
// connection setting from the environment, and nothing can reach a hosted
// project: every address comes from the local CLI and passes the loopback guard.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { localDockerEnvironment } from "./foundation-native-isolation.mjs";
import { assertFixturePath, ensureFixtureDirectory } from "./foundation-native-paths.mjs";
import { compareFingerprints, replaySteps } from "./foundation-replay.mjs";
import {
  E2E_DB_CONTAINER,
  E2E_FIXTURE,
  assertLocalFoundationTarget,
  fixtureWorkdir,
  replayMigrationNames,
} from "./foundation-e2e-target.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Resolves the workspace, the pinned local Docker context and a child
 * environment without any SUPABASE_* or DOCKER_* variables from the caller
 * (the same guard as the native fixture, see localDockerEnvironment). */
export function openFixture(root = process.cwd()) {
  const { env, dockerArgs } = localDockerEnvironment();
  return {
    root,
    workdir: fixtureWorkdir(root),
    env,
    dockerArgs,
    cliPath: path.resolve(root, "node_modules/supabase/dist/supabase.js"),
  };
}

/** The exact workspace contents: the config template and the replay copies. */
function expectedWorkspace(root) {
  const { steps } = replaySteps(root);
  return {
    config: readFileSync(path.join(root, E2E_FIXTURE.configTemplate)),
    migrations: replayMigrationNames(steps).map((step) => ({
      name: step.name,
      bytes: readFileSync(path.join(root, step.file)),
    })),
  };
}

function refuseForeignWorkspace(fixture) {
  const supabase = path.join(fixture.workdir, "supabase");
  for (const directory of [fixture.workdir, supabase]) {
    if (existsSync(directory) && readdirSync(directory).some((name) => /^\.env/i.test(name)))
      throw new Error("Dotenv files are not allowed in the test copy workspace");
  }
  if (existsSync(path.join(supabase, ".temp", "project-ref")))
    throw new Error("The test copy workspace must never be linked to a hosted project");
}

/** (Re)writes the workspace from the repository. Only while the stack is down. */
export function prepareWorkspace(fixture) {
  const relative = path.relative(fixture.root, fixture.workdir);
  ensureFixtureDirectory(fixture.root, relative);
  ensureFixtureDirectory(fixture.workdir, "supabase");
  refuseForeignWorkspace(fixture);
  const migrations = path.join(fixture.workdir, "supabase", "migrations");
  if (existsSync(migrations)) {
    assertFixturePath(fixture.workdir, "supabase/migrations", { type: "directory" });
    rmSync(migrations, { recursive: true });
  }
  ensureFixtureDirectory(fixture.workdir, "supabase/migrations");
  const expected = expectedWorkspace(fixture.root);
  writeFileSync(path.join(fixture.workdir, "supabase", "config.toml"), expected.config);
  for (const migration of expected.migrations)
    writeFileSync(path.join(migrations, migration.name), migration.bytes, { flag: "wx" });
  verifyWorkspace(fixture);
  return expected.migrations.length;
}

/** Fails unless the workspace holds exactly the template and the replay copies. */
export function verifyWorkspace(fixture) {
  refuseForeignWorkspace(fixture);
  const expected = expectedWorkspace(fixture.root);
  assertFixturePath(fixture.workdir, "supabase/config.toml", { type: "file" });
  if (
    digest(readFileSync(path.join(fixture.workdir, "supabase/config.toml"))) !==
    digest(expected.config)
  )
    throw new Error("Test copy config differs from e2e/foundation/fixture/supabase-config.toml");
  const directory = path.join(fixture.workdir, "supabase", "migrations");
  const present = readdirSync(directory).sort();
  const names = expected.migrations.map((migration) => migration.name);
  if (JSON.stringify(present) !== JSON.stringify(names))
    throw new Error("Test copy migrations differ from the database/foundation replay");
  for (const migration of expected.migrations) {
    assertFixturePath(fixture.workdir, `supabase/migrations/${migration.name}`, { type: "file" });
    if (digest(readFileSync(path.join(directory, migration.name))) !== digest(migration.bytes))
      throw new Error(`Test copy migration ${migration.name} differs from its source`);
  }
  return names.length;
}

function cli(fixture, args, { allowFailure = false } = {}) {
  const result = spawnSync(
    process.execPath,
    [fixture.cliPath, ...args, "--workdir", fixture.workdir],
    {
      cwd: fixture.workdir,
      env: fixture.env,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  if (result.status !== 0 && !allowFailure) {
    // CLI output can contain local keys: print only lines without them.
    const safe = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/key|secret|jwt|password|token|postgresql:\/\//i.test(line))
      .slice(-25)
      .join("\n");
    throw new Error(`supabase ${args[0]} failed (exit ${result.status}).\n${safe}`);
  }
  return result;
}

function docker(fixture, args, options = {}) {
  return spawnSync("docker", [...fixture.dockerArgs, ...args], {
    env: fixture.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

/** True when this project's database container is running. */
export function isRunning(fixture) {
  const result = docker(fixture, [
    "ps",
    "--filter",
    `name=^/${E2E_DB_CONTAINER}$`,
    "--filter",
    `label=com.supabase.cli.project=${E2E_FIXTURE.projectId}`,
    "--format",
    "{{.Names}}",
  ]);
  return result.status === 0 && result.stdout.trim() === E2E_DB_CONTAINER;
}

export function startStack(fixture) {
  verifyWorkspace(fixture);
  cli(fixture, ["start", "--exclude", E2E_FIXTURE.excludedServices]);
}

/** Stops and deletes only this project's containers and volumes. */
export function stopStack(fixture) {
  cli(fixture, ["stop", "--project-id", E2E_FIXTURE.projectId, "--no-backup"]);
}

/** Local addresses and keys from the CLI, after the loopback guard. Never print. */
export function readStatus(fixture) {
  const status = JSON.parse(cli(fixture, ["status", "-o", "json"]).stdout);
  const apiUrl = assertLocalFoundationTarget({ apiUrl: status.API_URL, dbUrl: status.DB_URL });
  const mailUrl = new URL(status.MAILPIT_URL ?? status.INBUCKET_URL);
  if (mailUrl.hostname !== "127.0.0.1" || mailUrl.port !== String(E2E_FIXTURE.mailPort))
    throw new Error("Unexpected mail catcher address");
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(status.PUBLISHABLE_KEY ?? ""))
    throw new Error("Local publishable key missing");
  if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(status.SECRET_KEY ?? ""))
    throw new Error("Local secret key missing");
  return {
    apiUrl,
    dbUrl: status.DB_URL,
    mailUrl: mailUrl.origin,
    publishableKey: status.PUBLISHABLE_KEY,
    secretKey: status.SECRET_KEY,
  };
}

/** psql inside this project's database container (never a network address). */
export function psql(fixture, statement, { user = "postgres" } = {}) {
  if (!["postgres", "supabase_admin"].includes(user)) throw new Error("Unexpected database role");
  const result = docker(
    fixture,
    [
      "exec",
      "-i",
      E2E_DB_CONTAINER,
      "psql",
      "-XqAt",
      "-U",
      user,
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement }
  );
  if (result.status !== 0)
    throw new Error(
      `Test copy SQL failed: ${String(result.stderr).split("\n").slice(0, 4).join(" ")}`
    );
  return result.stdout.trim();
}

export const HOOK_GRANTS_FILE = "database/foundation/replay/hosted-auth-hook-grants.sql";

/** The hosted platform's Auth hook grant (see the file); idempotent. */
export function applyHostedHookGrants(fixture) {
  psql(fixture, readFileSync(path.join(fixture.root, HOOK_GRANTS_FILE), "utf8"));
}

export const PUBLIC_TABLES_QUERY =
  "select count(*) from information_schema.tables where table_schema = 'public';";

/**
 * Proves the running database is the production schema and nothing else:
 * zero tables in public (so any retired-database call fails as it does live),
 * every replay file applied in order, and the structural fingerprint equal to
 * database/foundation/fingerprint.json (read with a neutral search_path, as on
 * the hosted project).
 */
export function verifySchema(fixture) {
  const publicTables = Number(psql(fixture, PUBLIC_TABLES_QUERY));
  if (publicTables !== 0) throw new Error(`Expected 0 tables in public, found ${publicTables}`);
  const { updates, steps } = replaySteps(fixture.root);
  const expected = replayMigrationNames(steps).map((step) => step.name.split("_")[0]);
  const applied = psql(
    fixture,
    "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;"
  ).split(",");
  if (JSON.stringify(applied) !== JSON.stringify(expected))
    throw new Error("Applied migrations differ from the database/foundation replay");
  // Fingerprint the replay itself: the hosted hook grant (HOOK_GRANTS_FILE) is
  // left out inside a transaction that is always rolled back.
  const rows = psql(
    fixture,
    [
      "begin;",
      "revoke usage on schema internal from supabase_auth_admin;",
      "set local search_path to pg_catalog;",
      readFileSync(path.join(fixture.root, "database/foundation/fingerprint.sql"), "utf8"),
      "rollback;",
    ].join("\n")
  );
  const categories = Object.fromEntries(
    rows
      .split("\n")
      .map((line) => line.split("|"))
      .map(([category, items, fingerprint]) => [category, { items: Number(items), fingerprint }])
  );
  const recorded = JSON.parse(
    readFileSync(path.join(fixture.root, "database/foundation/fingerprint.json"), "utf8")
  );
  const differences = compareFingerprints(recorded, { updates, categories });
  if (differences.length > 0)
    throw new Error(
      `Test copy schema differs from fingerprint.json:\n  ${differences.join("\n  ")}`
    );
  return { publicTables, migrations: applied.length, updates: updates.length };
}
