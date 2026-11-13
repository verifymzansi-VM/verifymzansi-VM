import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VideoAutoplayState {
  autoplayEnabled: boolean;
  setAutoplayEnabled: (enabled: boolean) => void;
}

/**
 * Sticky showroom playback intent, like the global mute button: after the user
 * presses play on the showroom's centre card, each card that moves to the
 * centre keeps playing by itself (muted); after the user presses pause, none
 * does until the user presses play again. Data saver, reduced data and
 * reduced motion always override it. Feed cards' Preview does not change it.
 * Persisted across sessions.
 */
export const useVideoAutoplayStore = create<VideoAutoplayState>()(
  persist(
    (set) => ({
      autoplayEnabled: false,
      setAutoplayEnabled: (enabled: boolean) => set({ autoplayEnabled: enabled }),
    }),
    {
      // Key predates feed cards sharing this intent; kept so saved choices carry over.
      name: "vmz-showroom-autoplay",
      // Only persist the autoplayEnabled boolean, not the actions
      partialize: (state) => ({ autoplayEnabled: state.autoplayEnabled }),
    }
  )
);
