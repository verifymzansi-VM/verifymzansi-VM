import { runAudit } from "./lib/audit-runtime";
runAudit("kyc").catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
