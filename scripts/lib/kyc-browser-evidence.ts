export type BrowserScenario = {
  file: string;
  title: string;
  project: string;
  status: string;
  expectedStatus: string;
  resultStatus: string;
};
const requiredTitles = [
  "authenticated synthetic document submission, private evidence and independent reviewer resubmission",
  "synthetic selfie and ordinary manual approvals complete verification, lock the legal name and schedule retention",
  "high-risk approval stays pending until an independent governor approves through the governance UI",
];

/** A smoke-only browser run must not attest the required authenticated KYC lane. */
export function assertKycAuthenticatedScenarios(scenarios: BrowserScenario[]) {
  for (const project of ["chromium", "mobile-chrome"]) {
    for (const title of requiredTitles) {
      const matches = scenarios.filter(
        (row) =>
          row.project === project &&
          row.title === title &&
          /(?:^|\/)kyc-authenticated\.spec\.ts$/.test(row.file.replace(/\\/g, "/"))
      );
      if (
        matches.length !== 1 ||
        matches[0].status !== "expected" ||
        matches[0].expectedStatus !== "passed" ||
        matches[0].resultStatus !== "passed"
      ) {
        throw new Error(`Required KYC scenario did not pass: ${project}: ${title}`);
      }
    }
  }
}
