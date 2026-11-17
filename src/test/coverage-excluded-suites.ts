/**
 * DOM-heavy suites that are left out of the coverage run (V8 instrumentation
 * makes them time out). CI runs them on their own, without coverage, in the
 * "coverage-excluded" lane (`pnpm test:coverage:excluded`), so the coverage
 * lane plus this lane together run every unit test exactly once.
 */
export const COVERAGE_EXCLUDED_SUITES: readonly string[] = [
  "src/app/(marketplace)/mzansi-business/discovery-bar.test.tsx",
  "src/app/post/create-business/page.test.tsx",
  "src/app/dsar/page.test.tsx",
  "src/app/verification/page.test.tsx",
  "src/app/post/edit-listing/[id]/page.test.tsx",
];
