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

export const KYC_BROWSER_PROJECTS = ["chromium", "mobile-chrome"] as const;

/** A smoke-only browser run must not attest the required authenticated KYC lane. */
export function assertKycAuthenticatedScenarios(
  scenarios: BrowserScenario[],
  projects: readonly string[] = KYC_BROWSER_PROJECTS
) {
  if (projects.length === 0) throw new Error("No browser project to check");
  for (const project of projects) {
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

type ReportSuite = {
  specs?: Array<{
    file: string;
    line: number;
    title: string;
    tests?: Array<{
      status: string;
      projectName: string;
      expectedStatus: string;
      results?: Array<{ status: string }>;
    }>;
  }>;
  suites?: ReportSuite[];
};

/** Every test result of a Playwright JSON report, one row per test and project. */
export function scenariosFromReport(report: {
  suites?: ReportSuite[];
}): Array<BrowserScenario & { key: string }> {
  const scenarios: Array<BrowserScenario & { key: string }> = [];
  const collect = (suites: ReportSuite[]) => {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? [])
          scenarios.push({
            key: `${spec.file}:${spec.line}:${spec.title}`,
            status: test.status,
            file: spec.file,
            title: spec.title,
            project: test.projectName,
            expectedStatus: test.expectedStatus,
            resultStatus: test.results?.at(-1)?.status ?? "missing",
          });
      }
      collect(suite.suites ?? []);
    }
  };
  collect(report.suites ?? []);
  return scenarios;
}
