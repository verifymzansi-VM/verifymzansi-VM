export const VIDEO_SESSION_IDLE_MS = 30 * 60 * 1000;

interface VideoSession {
  playbackId: string;
  watched: number;
  lastActivity: number;
  submitted: boolean;
  retryAfter: number;
}

// Shared by showroom, feed and detail players, including when storage is unavailable.
const fallback = new Map<string, VideoSession>();

export function readVideoSession(key: string, now: number): VideoSession {
  let session = fallback.get(key);
  try {
    const stored = localStorage.getItem(key);
    if (stored) session = JSON.parse(stored) as VideoSession;
  } catch {
    // Private browsing/storage restrictions must not break the player.
  }
  if (
    session &&
    typeof session.playbackId === "string" &&
    Number.isFinite(session.watched) &&
    Number.isFinite(session.lastActivity) &&
    now >= session.lastActivity &&
    now - session.lastActivity < VIDEO_SESSION_IDLE_MS
  ) {
    return { ...session };
  }
  return {
    playbackId: crypto.randomUUID(),
    watched: 0,
    lastActivity: now,
    submitted: false,
    retryAfter: 0,
  };
}

export function writeVideoSession(key: string, session: VideoSession) {
  fallback.set(key, { ...session });
  try {
    localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Fall back to shared in-memory state for this page.
  }
}
