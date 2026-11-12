// Rows of a Playwright JSON report, one per test and browser project.
export type BrowserScenario = {
  file: string;
  title: string;
  project: string;
  status: string;
  expectedStatus: string;
  resultStatus: string;
};
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
