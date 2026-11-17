import { test, type TestInfo } from "@playwright/test";

/** Thrown only when the exact known symptom of a recorded break is observed. */
export class KnownBreak extends Error {
  override name = "KnownBreak";
}

/** Time left for Playwright to record a failure before the test's own limit. */
const MARGIN_MS = 15_000;

/** The KnownBreak the current test's characterise() let through, if any. */
let knownBreak: string | null = null;

/**
 * Pins an expected failure to its known cause (the pattern of
 * showroom-contact.spec.ts and member-post-publish.spec.ts). While the test is
 * marked test.fail(), only a KnownBreak may fail it; any other failure (a setup
 * error, a changed page) is recorded and swallowed, so the test passes and
 * Playwright reports "expected to fail, but passed": the run turns red. The
 * same happens when the break is fixed but the mark is still there. Once the
 * mark is removed, every failure is reported as usual.
 *
 * A test that runs out of time would count as the expected failure, so the
 * body must finish before the test's limit (minus a margin): a hang becomes an
 * ordinary failure, which the mark cannot hide. Failures outside the body (a
 * hook, a route handler) are caught by requireOnlyKnownBreak.
 */
export async function characterise(note: string, body: () => Promise<void>) {
  const info = test.info();
  const expectingFailure = info.expectedStatus === "failed";
  knownBreak = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    if (info.timeout > MARGIN_MS)
      timer = setTimeout(
        () => reject(new Error(`${note}: the step did not finish in time`)),
        info.timeout - MARGIN_MS
      );
  });
  try {
    await Promise.race([body(), deadline]);
  } catch (error) {
    if (error instanceof Error && error.name === "KnownBreak") {
      knownBreak = error.message;
      throw error;
    }
    if (!expectingFailure) throw error;
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    info.annotations.push({ type: "not the known break", description: message });
    console.error(`[${note}] failed for another reason, so the run must turn red: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For an afterEach hook. A test marked test.fail() may fail only through the
 * KnownBreak that characterise() let through: exactly one error, that one.
 * Anything else that failed the test (an error in another hook, a route
 * handler, a second error) would otherwise count as the expected failure, so
 * the test is then reported as unexpected: the run turns red. A marked test
 * that passed is left as it is (Playwright already reports it as red).
 */
export function requireOnlyKnownBreak(info: TestInfo) {
  const seen = knownBreak;
  knownBreak = null;
  if (info.expectedStatus !== "failed" || info.status === "passed") return;
  const errors = info.errors.map((error) => `${error.message ?? ""}\n${error.stack ?? ""}`);
  if (seen !== null && errors.length === 1 && errors[0].includes(seen)) return;
  info.annotations.push({
    type: "not only the known break",
    description: `${errors.length} error(s); first: ${errors[0]?.split("\n")[0] ?? "none"}`,
  });
  console.error("A marked test failed for a reason other than its known break: the run turns red.");
  info.expectedStatus = "passed";
}
