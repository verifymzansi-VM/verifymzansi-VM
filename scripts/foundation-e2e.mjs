#!/usr/bin/env node
// Private test copy that behaves like production (M0.7): the restored website
// in foundation mode against a throwaway local database built only from
// database/foundation/, with mock Ozow, the e2e SMS mock and the local mail
// catcher. Run with `node --import tsx scripts/foundation-e2e.mjs <command>`:
//
//   up      start the stack if needed, prove the schema, seed once
//   reset   delete the stack and its data, then `up`
//   build   `up`, then build the website for the copy
//   serve   `up`, build (unless PLAYWRIGHT_SKIP_BUILD=1), start the website
//           on http://127.0.0.1:3110 (the Playwright web server command)
//   down    stop and delete the stack and its data
//
// It takes no connection settings: every address comes from the local CLI
// and must pass the loopback guard (scripts/lib/foundation-e2e-target.mjs).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  applyHostedHookGrants,
  isRunning,
  openFixture,
  prepareWorkspace,
  psql,
  readStatus,
  startStack,
  stopStack,
  verifySchema,
  verifyWorkspace,
} from "./lib/foundation-e2e-stack.mjs";
import { seedTestCopy } from "./lib/foundation-e2e-seed.mjs";
import { E2E_FIXTURE } from "./lib/foundation-e2e-target.mjs";
import { foundationWebsiteEnv } from "./lib/foundation-e2e-website.mjs";

const log = (line) => process.stdout.write(`[foundation-e2e] ${line}\n`);
const seconds = (started) => `${Math.round((Date.now() - started) / 1000)} s`;

function readState(fixture, status) {
  if (!existsSync(E2E_FIXTURE.stateFile)) return null;
  const state = JSON.parse(readFileSync(E2E_FIXTURE.stateFile, "utf8"));
  const ids = Object.values(state.accounts ?? {}).map((account) => account.id);
  if (state.apiUrl !== status.apiUrl || ids.length !== 4) return null;
  const known = psql(
    fixture,
    `select count(*) from auth.users where id in (${ids.map((id) => `'${id.replace(/[^a-f0-9-]/g, "")}'`).join(",")});`
  );
  return known === "4" ? state : null;
}

async function up(fixture) {
  const started = Date.now();
  if (isRunning(fixture)) {
    verifyWorkspace(fixture);
    log("Stack already running; reusing it.");
  } else {
    const count = prepareWorkspace(fixture);
    log(`Workspace holds ${count} replay files copied from database/foundation/.`);
    startStack(fixture);
    log(`Stack started (${seconds(started)}).`);
  }
  const schema = verifySchema(fixture);
  applyHostedHookGrants(fixture);
  log(
    `Schema: candidate.sql + ${schema.updates} updates applied; ${schema.publicTables} tables in public; fingerprint matches fingerprint.json.`
  );
  const status = readStatus(fixture);
  const existing = readState(fixture, status);
  if (existing) {
    log("Test people and posts already seeded.");
    return { status, state: existing };
  }
  const seeded = await seedTestCopy({
    root: fixture.root,
    status,
    sql: (statement) => psql(fixture, statement),
    log,
  });
  const state = {
    ...seeded,
    apiUrl: status.apiUrl,
    mailUrl: status.mailUrl,
    // Local default publishable key: public by design. The secret key is not stored.
    publishableKey: status.publishableKey,
  };
  writeFileSync(E2E_FIXTURE.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  log(
    `Seeded ${Object.keys(state.accounts).length} accounts and ${state.posts.length} live posts (${seconds(started)}).`
  );
  return { status, state };
}

function runPnpm(args, env) {
  const command =
    process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/c", "pnpm", ...args]]
      : ["pnpm", args];
  const result = spawnSync(command[0], command[1], { env, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed`);
}

function build(env) {
  const started = Date.now();
  log("Building the website in foundation mode for the test copy.");
  runPnpm(["build"], env);
  log(`Website built (${seconds(started)}).`);
}

function serve(env) {
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(E2E_FIXTURE.appPort),
    ],
    { env, stdio: "inherit", windowsHide: true }
  );
  const stop = (signal) => !server.killed && server.kill(signal);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => process.exit(code ?? 0));
}

const command = process.argv[2];
if (process.argv.length !== 3 || !["up", "reset", "build", "serve", "down"].includes(command)) {
  process.stderr.write(
    "Usage: node --import tsx scripts/foundation-e2e.mjs up|reset|build|serve|down\n"
  );
  process.exit(2);
}
try {
  const fixture = openFixture();
  if (command === "down" || command === "reset") {
    stopStack(fixture);
    log("Stack stopped; its containers and data were deleted. Other stacks are untouched.");
  }
  if (command !== "down") {
    const { status } = await up(fixture);
    const env = foundationWebsiteEnv(status);
    if (command === "build") build(env);
    if (command === "serve") {
      if (process.env.PLAYWRIGHT_SKIP_BUILD !== "1") build(env);
      serve(env);
    }
  }
} catch (error) {
  process.stderr.write(`[foundation-e2e] ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
