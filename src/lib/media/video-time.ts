/** A playback position as players show it: 0:07, 1:45, or 1:02:03 past an hour. */
export function formatVideoTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = (total % 60).toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${mins.toString().padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

/** The player's time label: where playback is and how long the video is, e.g. "0:12 / 0:45". */
export function formatVideoProgress(currentTime: number, duration: number): string {
  return `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`;
}

/** The same position for screen readers, e.g. "0:12 of 0:45". */
export function describeVideoProgress(currentTime: number, duration: number): string {
  return `${formatVideoTime(currentTime)} of ${formatVideoTime(duration)}`;
}
