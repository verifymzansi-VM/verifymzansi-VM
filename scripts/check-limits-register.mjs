// Checks the limits register (docs/testing/limits-register.json): every
// registered limit is still enforced with its registered value where the
// register says, every limit has a test that names it (or reads the
// register), and no limit-looking line in the database snapshot, the shared
// rate limiter or the request body caps is missing from the register.
//
//   node scripts/check-limits-register.mjs            # check (CI)
//   node scripts/check-limits-register.mjs --list     # also print each limit and where it is now
//
// Run after `pnpm db:foundation:snapshot` so database/foundation/current is up
// to date (CI job foundation-replay does both). What the scanner cannot catch
// is listed in docs/testing/limits-register.md.
import {
  REGISTER_FILE,
  SCANNER_SCOPE,
  anchorLocation,
  checkLimitsRegister,
  readLimitsRegister,
} from "./lib/limits-register.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--list")) {
  console.error("Usage: node scripts/check-limits-register.mjs [--list]");
  process.exit(2);
}
const root = process.cwd();
const register = readLimitsRegister(root);
const { failures, stats } = checkLimitsRegister({ root, register });

if (args.includes("--list"))
  for (const entry of register.limits)
    console.log(`${entry.id}\t${entry.value}\t${anchorLocation(root, entry.enforcedAt[0])}`);

if (failures.length) {
  console.error(`Limits register check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(`Update ${REGISTER_FILE} (and the limit's test) in the same pull request.`);
  process.exit(1);
}
console.log(
  `Limits register matches the code: ${stats.limits} limits (${stats.behaviour} with a behaviour test, ${stats.register} checked by a register-driven test, ${stats.declaration} declared values whose enforcing mechanism is tested), ${stats.notLimits} reviewed non-limits, ${stats.findings} scanned lines.`
);
console.log(`Scanned: ${SCANNER_SCOPE.join("; ")}.`);
