/**
 * Optional "dead man's switch" ping for the timed companion Workers.
 *
 * After a scheduled run succeeds, the Worker calls an external heartbeat
 * monitor. The monitor alerts a person when the pings stop, which catches a
 * job that fails, hangs or stops being scheduled at all. Each job reads its
 * own optional URL (for example HEARTBEAT_URL_OPS_JOBS, set as a Worker
 * secret); an unset URL does nothing.
 *
 * A heartbeat never fails the job and never logs its URL: for most monitors
 * the URL itself is the credential.
 */

export const HEARTBEAT_TIMEOUT_MS = 5_000;

export type HeartbeatOutcome = "not-configured" | "sent" | "failed";

export async function sendHeartbeat(
  job: string,
  url: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<HeartbeatOutcome> {
  if (!url) return "not-configured";
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    console.warn(`${job} heartbeat skipped: invalid heartbeat configuration`);
    return "failed";
  }
  if (target.protocol !== "https:" || target.username || target.password) {
    console.warn(`${job} heartbeat skipped: invalid heartbeat configuration`);
    return "failed";
  }
  try {
    const response = await fetchImpl(target.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => {
      // Only drains the unread body; the status below decides the result.
    });
    if (response.ok) return "sent";
    console.warn(`${job} heartbeat was not accepted (HTTP ${response.status})`);
    return "failed";
  } catch {
    // Error text can repeat the URL, so only the job name is logged.
    console.warn(`${job} heartbeat could not be delivered`);
    return "failed";
  }
}
