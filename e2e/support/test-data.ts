import { test } from "@playwright/test";

/**
 * For a test that needs data the run may not have (posts, video cards, an
 * account). Outside CI a missing piece skips the test with the reason. In CI
 * it fails the test: a skip there would turn a run green without checking
 * anything, so CI must supply the data (see skip-policy.ts).
 */
export function requireTestData(present: boolean, missing: string): void {
  if (present) return;
  if (process.env.CI) {
    throw new Error(
      `Test data missing in CI: ${missing}. CI must provide it; a skip would hide that this test checked nothing.`
    );
  }
  test.skip(true, `Test data missing: ${missing}`);
}
