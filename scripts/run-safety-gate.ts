import { runAudit } from "./lib/audit-runtime";
import type { AuditMode } from "./lib/check-registry";
const mode = process.argv[2];
if (!["review", "ci-review", "release", "inventory"].includes(mode)) {
  console.error("Usage: run-safety-gate.ts <review|ci-review|release|inventory> [audit flags]");
  process.exitCode = 1;
} else {
  runAudit(mode as AuditMode, process.argv.slice(3)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
