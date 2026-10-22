import type { FeedSession } from "./session";

export type FeedStoreSnapshot = {
  session: FeedSession | null;
  notice: "expired" | null;
};

/** Browser storage is read only on subscription, after hydration. Snapshot
 * identity stays stable until an actual change; Strict Mode subscriptions
 * reuse the same initial session instead of creating it twice.
 */
export function createFeedSessionStore(initialize: () => FeedStoreSnapshot) {
  const serverSnapshot: FeedStoreSnapshot = { session: null, notice: null };
  let snapshot = serverSnapshot;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (snapshot === serverSnapshot) {
        snapshot = initialize();
        notify();
      }
      return () => {
        listeners.delete(listener);
      };
    },
    setSession(session: FeedSession) {
      snapshot = { ...snapshot, session };
      notify();
    },
  };
}
