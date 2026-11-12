// Checks that the shared error-reason list (src/lib/foundation/error-reasons.ts)
// names exactly the reasons, with their SQLSTATEs, that the current database
// functions raise (database/foundation/current/functions), that every listed
// message is still raised, and that website code matches reasons only through
// the list's helpers.
//
//   node scripts/check-foundation-error-reasons.mjs           # check (CI)
//   node scripts/check-foundation-error-reasons.mjs --write   # regenerate the list
//
// Run after `pnpm db:foundation:snapshot` so the current schema is up to date
// (CI job foundation-replay does both).
import { runReasonCheck } from "./lib/foundation-error-reasons.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--write")) {
  console.error("Usage: node scripts/check-foundation-error-reasons.mjs [--write]");
  process.exit(2);
}
const { failures, reasons } = runReasonCheck({ write: args.includes("--write") });
if (failures.length) {
  console.error(`Shared error-reason list check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "Regenerate the list with `node scripts/check-foundation-error-reasons.mjs --write`, then update the callers the type check names."
  );
  process.exit(1);
}
console.log(`Shared error-reason list matches the database: ${reasons} reasons.`);
