// The WebKit fake camera (e2e/support/webkit-fake-camera.ts and its page
// script) is test harness only. These tests fail if the website's source
// (src/, workers/, public/, the build configs) names it or imports anything from
// e2e/, if anything other than the browser-test config installs it, or if a
// production build present in this checkout (.next, .open-next) contains it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_SCRIPT = "e2e/support/webkit-fake-camera.page.js";
const INSTALLER = "e2e/support/webkit-fake-camera.ts";
/** Set by the page script; unique to it. */
const MARKER = "__verifymzansiWebKitFakeCamera";
const NAME = "webkit-fake-camera";
/** The only files allowed to name the fake camera outside e2e/. */
const ALLOWED_OUTSIDE_E2E = new Set([
  "playwright.foundation.config.ts",
  "scripts/e2e-fake-camera-isolation.test.mjs",
]);
const TEXT = /\.(?:[cm]?[jt]sx?|json|jsonc|html|css|md|toml|ya?ml|txt|svg|webmanifest)$/;
const IMPORTS_E2E =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`](?:[^"'`]*\/)?e2e\/[^"'`]*["'`]/;

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter((file) => file && existsSync(path.join(root, file)));
const read = (file) => readFileSync(path.join(root, file), "utf8");

/** Website code and anything a production build reads. */
const productionSource = tracked.filter(
  (file) =>
    TEXT.test(file) &&
    (/^(?:src|workers|public)\//.test(file) ||
      /^(?:next|open-next|tailwind|postcss)\.config\.[cm]?[jt]s$/.test(file) ||
      /^wrangler(?:\.[\w-]+)?\.toml$/.test(file))
);

test("the fake camera files exist and carry the marker (the checks below are not vacuous)", () => {
  assert.ok(read(PAGE_SCRIPT).includes(MARKER), `${PAGE_SCRIPT} sets ${MARKER}`);
  assert.ok(read(INSTALLER).includes("webkit-fake-camera.page.js"));
  assert.ok(
    productionSource.some((file) => file.startsWith("src/")),
    "src/ files are scanned"
  );
});

test("website source never names the fake camera or imports from e2e/", () => {
  const offenders = productionSource.filter((file) => {
    const text = read(file);
    return text.includes(MARKER) || text.includes(NAME) || IMPORTS_E2E.test(text);
  });
  assert.deepEqual(offenders, []);
});

test("only the browser-test config and e2e/ name the fake camera", () => {
  const naming = tracked.filter(
    (file) =>
      TEXT.test(file) &&
      !file.startsWith("e2e/") &&
      !ALLOWED_OUTSIDE_E2E.has(file) &&
      /** Ledgers and docs may describe it; they are never built. */
      !file.endsWith(".md") &&
      read(file).includes(NAME)
  );
  assert.deepEqual(naming, []);
  assert.match(
    read("playwright.foundation.config.ts"),
    /from "\.\/e2e\/support\/webkit-fake-camera"/,
    "the browser-test config installs it"
  );
});

test("the e2e import check catches the usual import forms", () => {
  for (const line of [
    'import { x } from "../../e2e/support/webkit-fake-camera";',
    "const m = await import('../e2e/support/test-data');",
    'require("e2e/support/skip-policy")',
  ])
    assert.match(line, IMPORTS_E2E, line);
  for (const line of ['import { x } from "@/lib/e2e-helpers";', 'const path = "/api/e2e";'])
    assert.doesNotMatch(line, IMPORTS_E2E, line);
});

/** Every file under a build output directory, if this checkout has one. */
function* filesUnder(directory) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isDirectory()) {
      if (entry !== "cache") yield* filesUnder(full);
    } else if (/\.(?:[cm]?js|html|json)$/.test(entry) && stat.size < 50_000_000) yield full;
  }
}

test("a production build in this checkout does not contain the fake camera", (t) => {
  const outputs = [".next", ".open-next"].map((dir) => path.join(root, dir)).filter(existsSync);
  if (outputs.length === 0) {
    t.diagnostic("no .next or .open-next build here; the source checks above cover it");
    return;
  }
  const offenders = [];
  for (const output of outputs)
    for (const file of filesUnder(output)) {
      const text = readFileSync(file, "utf8");
      if (text.includes(MARKER) || text.includes("webkit-fake-camera.page"))
        offenders.push(path.relative(root, file));
    }
  assert.deepEqual(offenders, []);
});
