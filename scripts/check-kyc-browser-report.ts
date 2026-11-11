// Fails unless the Playwright JSON report shows each required signed-in KYC
// scenario (e2e/kyc-authenticated.spec.ts) passed in the given project.
// Usage: tsx scripts/check-kyc-browser-report.ts <report.json> <project>
import { readFileSync } from "node:fs";
import {
  assertKycAuthenticatedScenarios,
  KYC_BROWSER_PROJECTS,
  scenariosFromReport,
} from "./lib/kyc-browser-evidence";

const [file, project] = process.argv.slice(2);
if (!file || !project || !(KYC_BROWSER_PROJECTS as readonly string[]).includes(project))
  throw new Error(
    `Usage: check-kyc-browser-report.ts <report.json> <${KYC_BROWSER_PROJECTS.join("|")}>`
  );
const scenarios = scenariosFromReport(JSON.parse(readFileSync(file, "utf8")));
assertKycAuthenticatedScenarios(scenarios, [project]);
console.log(`Signed-in KYC scenarios passed in ${project}.`);
