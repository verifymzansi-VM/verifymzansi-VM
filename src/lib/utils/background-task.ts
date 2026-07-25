import { createLogger } from "./logger";

const log = createLogger("BackgroundTask");

/**
 * Schedule fire-and-forget async work so it survives the HTTP response.
 *
 * On Cloudflare Workers (OpenNext), unawaited promises are not guaranteed to
 * complete once the response is sent, so the task is registered with the
 * execution context's `waitUntil`. Outside Workers (dev/test) there is no
 * execution context, so the task simply runs detached with failures logged.
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

  void (async () => {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { ctx } = await getCloudflareContext({ async: true });
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(observed);
      }
    } catch {
      // Not running on Cloudflare Workers — the detached task above already
      // logs failures, so there is nothing more to do.
    }
  })();
}
