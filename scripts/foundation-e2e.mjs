#!/usr/bin/env node
// Private test copy that behaves like production (M0.7): the restored website
// in foundation mode against a throwaway local database built only from
// database/foundation/, with mock Ozow, the e2e SMS mock and the local mail
// catcher. Run with `node --import tsx scripts/foundation-e2e.mjs <command>`:
//
//   up      start the stack if needed, prove the schema, seed once
//   reset   delete the stack and its data, then `up`
//   build   `up`, then build the website for the copy
//   serve   `up`, build (unless PLAYWRIGHT_SKIP_BUILD=1), start the local rate
//           limiter stub, the local email relay to the mail catcher and the
//           website on http://127.0.0.1:3110 (the Playwright web server command),
//           with a fence that keeps the website's own requests on this machine
//   down    stop and delete the stack and its data
//
// It takes no connection settings: every address comes from the local CLI
// and must pass the loopback guard (scripts/lib/foundation-e2e-target.mjs).
import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { startLocalLimiter } from "./lib/foundation-e2e-limiter.mjs";
import { startLocalMailRelay } from "./lib/foundation-e2e-mail-relay.mjs";
import {
  E2E_FIXTURE,
  OUTBOUND_LOG_FILE,
  SERVER_LOG_FILE,
  TEST_SMS_SINK_FILE,
} from "./lib/foundation-e2e-target.mjs";
import {
  LOCAL_LIMITER_KEY,
  LOCAL_MAIL_RELAY_KEY,
  assertBuildIsCopy,
  foundationWebsiteEnv,
  writeBuildStamp,
} from "./lib/foundation-e2e-website.mjs";

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

/** Files the copy writes outside the stack (all git-ignored). */
const RUN_FILES = [TEST_SMS_SINK_FILE, OUTBOUND_LOG_FILE, SERVER_LOG_FILE];
function removeLocalArtifacts(root) {
  for (const file of [E2E_FIXTURE.stateFile, ...RUN_FILES])
    rmSync(path.join(root, file), { force: true });
  for (const directory of ["public/e2e-media", "tmp/e2e-private-storage"]) {
    const full = path.join(root, directory);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full))
      if (name !== ".gitkeep") rmSync(path.join(full, name), { recursive: true, force: true });
  }
}

async function up(fixture) {
  const started = Date.now();
  // Specs must never read a code or a request from an earlier run.
  for (const file of RUN_FILES) rmSync(path.join(fixture.root, file), { force: true });
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
  writeBuildStamp(env);
  assertBuildIsCopy(env);
  log(`Website built and checked: no hosted settings in the client bundle (${seconds(started)}).`);
}

async function serve(env) {
  // Never serve a .next built for production or with other settings.
  assertBuildIsCopy(env);
  const limiter = await startLocalLimiter({
    port: E2E_FIXTURE.limiterPort,
    apiKey: LOCAL_LIMITER_KEY,
  });
  log(`Local rate limiter stub listening on 127.0.0.1:${E2E_FIXTURE.limiterPort}.`);
  const mailRelay = await startLocalMailRelay({
    port: E2E_FIXTURE.mailRelayPort,
    apiKey: LOCAL_MAIL_RELAY_KEY,
    mailOrigin: `http://127.0.0.1:${E2E_FIXTURE.mailPort}`,
  });
  log(`Local email relay to the mail catcher listening on 127.0.0.1:${E2E_FIXTURE.mailRelayPort}.`);
  // The website's own server process (only this one) gets the outbound fence:
  // loopback requests pass, everything else is refused and recorded.
  const fence = pathToFileURL(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "lib",
      "foundation-e2e-outbound-preload.mjs"
    )
  ).href;
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
    {
      env: { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${fence}`.trim() },
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    }
  );
  // Show the server output as before and keep a copy for specs that check its
  // structured log lines (for example legacy_client_in_foundation, M0.11).
  const serverLogFile = path.resolve(SERVER_LOG_FILE);
  mkdirSync(path.dirname(serverLogFile), { recursive: true });
  const serverLog = createWriteStream(serverLogFile, { flags: "w" });
  server.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    serverLog.write(chunk);
  });
  server.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    serverLog.write(chunk);
  });
  const stop = (signal) => !server.killed && server.kill(signal);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", (code) => {
    serverLog.end();
    limiter.close();
    mailRelay.close();
    process.exit(code ?? 0);
  });
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
    removeLocalArtifacts(fixture.root);
    log(
      "Stack stopped; its containers, data and local files were deleted. Other stacks are untouched."
    );
  }
  if (command !== "down") {
    const { status } = await up(fixture);
    const env = foundationWebsiteEnv(status);
    if (command === "build") build(env);
    if (command === "serve") {
      if (process.env.PLAYWRIGHT_SKIP_BUILD !== "1") build(env);
      await serve(env);
    }
  }
} catch (error) {
  process.stderr.write(`[foundation-e2e] ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
