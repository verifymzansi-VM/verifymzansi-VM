// Evaluates next.config.js as a build with the given environment would, for
// the build-guard tests (data-backend-config, launch-config-build). Sentry's
// wrapper is replaced by the identity; the repository's own guard modules are
// the real ones.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);

/** @param {Record<string, string | undefined>} env */
export function buildNextConfig(env) {
  const source = readFileSync("next.config.js", "utf8");
  const evaluatedModule = { exports: {} };
  runInNewContext(source, {
    module: evaluatedModule,
    process: { env },
    URL,
    require: (name) => {
      if (name === "./package.json") return { version: "synthetic-build" };
      if (name === "./scripts/lib/next-typecheck-skip.cjs")
        return require("./next-typecheck-skip.cjs");
      if (name === "./scripts/lib/launch-config-build.cjs")
        return require("./launch-config-build.cjs");
      assert.equal(name, "@sentry/nextjs/config");
      return { withSentryConfig: (config) => config };
    },
  });
  return evaluatedModule.exports;
}
