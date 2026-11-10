/** Playwright's own errors for a request still in flight when the test's
 * context closes: a page can start a request (for example the verification
 * page's session start) just as its test finishes. Only these exact messages,
 * as the whole first line of the error, count; any other error, including a
 * timeout or a connection reset, is still the caller's to report. */
const ENDED_WITH_TEST =
  /^[\w.]+: (?:Test ended\.|Target page, context or browser has been closed|Response has been disposed)(?:\n|$)/;

/** True only for a route handler error caused by the test's own teardown. */
export function endedWithTest(error: unknown) {
  return error instanceof Error && ENDED_WITH_TEST.test(error.message);
}
