import { runAudit } from "./lib/audit-runtime";
runAudit("payments").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
