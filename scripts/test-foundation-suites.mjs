#!/usr/bin/env node
// Runs the given foundation behaviour suites side by side (at most 4 at once,
// or --jobs=N) and fails when any of them fails. See
// scripts/lib/foundation-suite-runner.mjs.
//
//   node scripts/test-foundation-suites.mjs [--jobs=N] scripts/test-foundation-x.mjs ...
import { main } from "./lib/foundation-suite-runner.mjs";

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
