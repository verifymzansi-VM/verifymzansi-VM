import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const sentryRoot = path.dirname(require.resolve("@sentry/nextjs/package.json"));
const nextVersion = require("next/package.json").version;

for (const format of ["cjs", "esm"]) {
  const filename = path.join(sentryRoot, "build", format, "config/util.js");
  let source = readFileSync(filename, "utf8");
  if (format === "esm") {
    // Model the bundler's empty module location with the actual helper source;
    // imports are supplied below, not replaced with an implementation stub.
    source = source
      .replace(/^import .+;\r?$/gm, "")
      .replace(/^export \{.+\};\r?$/gm, "")
      .replaceAll("import.meta.url", "__filename");
  }
  function load(moduleLocation, cwd) {
    let loaderCalls = 0;
    const trackedCreateRequire = (location) => {
      loaderCalls++;
      return createRequire(location);
    };
    const context = {
      exports: {},
      require: (name) => {
        if (name === "module") return { createRequire: trackedCreateRequire };
        if (name === "fs") return require("node:fs");
        if (name === "path") return path;
        // Semver helpers are unrelated to loader initialization/version lookup.
        if (name === "@sentry/core") return {};
        throw new Error(`Unexpected build-helper dependency: ${name}`);
      },
      __filename: moduleLocation,
      process: { cwd: () => cwd, argv: [] },
      createRequire: trackedCreateRequire,
      fs: require("node:fs"),
      path,
    };
    runInNewContext(`${source}\n;globalThis.lookupVersion = getNextjsVersion;`, context);
    return { context, calls: () => loaderCalls };
  }

  test(`Sentry ${format} build helper can load with workerd's empty filename`, () => {
    const loaded = load("", "/");
    assert.equal(loaded.calls(), 0, "Runtime import must not initialize a build-only Node loader");
  });

  test(`Sentry ${format} build helper still resolves Next from the SDK outside the app cwd`, () => {
    const loaded = load(filename, path.parse(process.cwd()).root);
    assert.equal(loaded.context.lookupVersion(), nextVersion);
    assert.ok(loaded.calls() > 0, "Build-time lookup must still use Node resolution");
  });
}
