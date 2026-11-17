import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  VISUAL_CONFIG,
  VISUAL_IMAGE,
  dockerRunArgs,
  imagePlaywrightVersion,
} from "./foundation-visual.mjs";

test("the browser image is a Playwright image pinned by digest, matching the installed Playwright", () => {
  const installed = JSON.parse(
    readFileSync("node_modules/@playwright/test/package.json", "utf8")
  ).version;
  assert.equal(imagePlaywrightVersion(VISUAL_IMAGE), installed);
  for (const unpinned of [
    "mcr.microsoft.com/playwright:v1.64.0-noble",
    "mcr.microsoft.com/playwright:latest",
    "example.com/other:v1.64.0-noble@sha256:" + "0".repeat(64),
  ])
    assert.throws(() => imagePlaywrightVersion(unpinned), /pinned by digest/);
});

test("the browser runs in the image on the host network, against the repository at its own path", () => {
  const args = dockerRunArgs({
    root: "/work/repo",
    uid: 1001,
    gid: 118,
    env: { CI: "true", PLAYWRIGHT_JSON_REPORT: "test-results/visual-report.json", EMPTY: "" },
    testArgs: ["--retries=1"],
  });
  const text = args.join(" ");
  assert.equal(args[0], "run");
  assert.match(text, /--rm --network host --ipc=host --user 1001:118 /);
  assert.match(text, /-v \/work\/repo:\/work\/repo -w \/work\/repo /);
  assert.match(text, / -e CI=true -e PLAYWRIGHT_JSON_REPORT=test-results\/visual-report.json /);
  assert.doesNotMatch(text, /EMPTY/);
  assert.equal(args[args.indexOf(VISUAL_IMAGE) + 1], "node");
  assert.deepEqual(args.slice(-4), [
    "node_modules/@playwright/test/cli.js",
    "test",
    `--config=${VISUAL_CONFIG}`,
    "--retries=1",
  ]);
});
