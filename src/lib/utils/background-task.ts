import { after } from "next/server";
import { createLogger } from "./logger";

const log = createLogger("BackgroundTask");

/**
 * Schedule fire-and-forget async work so it survives the HTTP response.
 *
 * Next.js registers the promise synchronously through `after`, which OpenNext
 * connects to the Cloudflare request's `waitUntil`. Registration must happen
 * before returning the response, including on the first request in an isolate.
 * Outside a Next.js request (scripts/tests), the observed task runs detached.
 */
export function scheduleBackgroundTask(task: Promise<unknown>, label = "background task"): void {
  // Always observe rejections so a failed task never surfaces as an
  // unhandled promise rejection, regardless of runtime.
  const observed = task.catch((error: unknown) => {
    log.error("Background task failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  try {
    after(observed);
  } catch (error) {
    // Tests and scripts have no Next.js request scope. In production, surface
    // failed registration so lost request lifetime protection is observable.
    if (process.env.NODE_ENV === "production") {
      log.error("Background task registration failed", {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
