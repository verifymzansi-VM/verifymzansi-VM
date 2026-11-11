#!/usr/bin/env node
// Picture checks of the chosen frontend against the foundation test copy
// (e2e/foundation/visual-regression.spec.ts, required check "Visual regression
// (chosen frontend)"). Run after `scripts/foundation-e2e.mjs up` and `build`:
//
//   node --import tsx scripts/foundation-visual.mjs [playwright test options]
//   node --import tsx scripts/foundation-visual.mjs --update-snapshots=changed   # new pictures
//   node --import tsx scripts/foundation-visual.mjs pull   # only fetch the pinned image
//
// Why two places: the test copy (local Supabase stack) needs Docker and the
// Supabase CLI, so it and the website run on the host, exactly as the
// e2e-foundation job runs them. The pictures need the browser build and fonts
// of the pinned Playwright image, so the browser runs inside that image
// (`docker run --network host`), pinned by digest, and reaches the website on
// the host's 127.0.0.1. Running the browser on the host would make pictures
// that depend on the runner's own fonts and packages; running the stack
// inside the image would need Docker-in-Docker.
//
// The same command runs locally (Linux only, behind the same local-Docker
// guard as the test copy), in CI and in the "Update Visual Baselines" workflow.
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openFixture, readStatus } from "./lib/foundation-e2e-stack.mjs";
import { E2E_FIXTURE, assertLocalFoundationTarget } from "./lib/foundation-e2e-target.mjs";

/** The browser image the approved pictures were made in. Its Playwright
 * version must equal the installed @playwright/test (checked below). */
export const VISUAL_IMAGE =
  "mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f"; // secret-scan: allow image digest
export const VISUAL_CONFIG = "playwright.visual.config.ts";
const WEBSITE_LOG = "tmp/foundation-e2e/visual-website.log";
const HEALTH_URL = `http://127.0.0.1:${E2E_FIXTURE.appPort}/api/health`;

const log = (line) => process.stdout.write(`[foundation-visual] ${line}\n`);

/** The Playwright version in an image reference (`playwright:v1.64.0-noble@...`). */
export function imagePlaywrightVersion(image) {
  const version = /\/playwright:v(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}$/.exec(image)?.[1];
  if (!version) throw new Error("The visual image must be a Playwright image pinned by digest");
  return version;
}

/** Arguments for `docker run`: the browser image on the host network, with the
 * repository mounted at the same path so report paths match the host. */
export function dockerRunArgs({ root, uid, gid, image = VISUAL_IMAGE, env = {}, testArgs = [] }) {
  const passed = Object.entries(env).flatMap(([key, value]) =>
    value === undefined || value === "" ? [] : ["-e", `${key}=${value}`]
  );
  return [
    "run",
    "--rm",
    "--network",
    "host",
    "--ipc=host",
    ...(uid === undefined ? [] : ["--user", `${uid}:${gid}`]),
    "-e",
    "HOME=/tmp",
    ...passed,
    "-v",
    `${root}:${root}`,
    "-w",
    root,
    image,
    "node",
    "node_modules/@playwright/test/cli.js",
    "test",
    `--config=${VISUAL_CONFIG}`,
    ...testArgs,
  ];
}

async function waitForWebsite(server, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("The website stopped before it was ready");
    try {
      const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The website did not answer /api/health in time");
}

function stopWebsite(server) {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once("exit", resolve);
    server.kill("SIGTERM");
    setTimeout(() => server.exitCode === null && server.kill("SIGKILL"), 15_000).unref();
  });
}

function pullImage(fixture) {
  const result = spawnSync("docker", [...fixture.dockerArgs, "pull", VISUAL_IMAGE], {
    env: fixture.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

async function main(testArgs) {
  const root = process.cwd();
  if (testArgs[0] === "pull") return pullImage(openFixture(root));
  const installed = JSON.parse(
    readFileSync(path.join(root, "node_modules/@playwright/test/package.json"), "utf8")
  ).version;
  if (imagePlaywrightVersion(VISUAL_IMAGE) !== installed)
    throw new Error(
      `@playwright/test ${installed} differs from the visual image's Playwright; update both together`
    );
  // Same guards as the test copy: this machine's own Docker, a loopback stack.
  const fixture = openFixture(root);
  assertLocalFoundationTarget({ apiUrl: readStatus(fixture).apiUrl });

  // `serve` re-proves the running copy (schema, seed) and the copy build, then
  // starts the website on 127.0.0.1:3110 without rebuilding.
  mkdirSync(path.dirname(path.join(root, WEBSITE_LOG)), { recursive: true });
  const websiteLog = createWriteStream(path.join(root, WEBSITE_LOG), { flags: "w" });
  const server = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/foundation-e2e.mjs", "serve"],
    {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_SKIP_BUILD: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  server.stdout.pipe(websiteLog);
  server.stderr.pipe(websiteLog);
  try {
    await waitForWebsite(server);
    log(`Website ready at ${HEALTH_URL.replace("/api/health", "")} (log: ${WEBSITE_LOG}).`);
    const args = dockerRunArgs({
      root,
      uid: process.getuid?.(),
      gid: process.getgid?.(),
      env: {
        CI: process.env.CI,
        PLAYWRIGHT_JSON_REPORT: process.env.PLAYWRIGHT_JSON_REPORT,
      },
      testArgs,
    });
    log(`Comparing pictures in ${VISUAL_IMAGE.split("@")[0]} (pinned by digest).`);
    const result = spawnSync("docker", [...fixture.dockerArgs, ...args], {
      env: fixture.env,
      stdio: "inherit",
    });
    return result.status ?? 1;
  } finally {
    await stopWebsite(server);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(
        `[foundation-visual] ${error instanceof Error ? error.message : error}\n`
      );
      process.exit(1);
    }
  );
}
