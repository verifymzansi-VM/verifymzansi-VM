import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VideoAutoplayState {
  autoplayEnabled: boolean;
  setAutoplayEnabled: (enabled: boolean) => void;
}

/**
 * Sticky video playback intent, shared by every card like the global mute
 * button: after the user presses play on any card (showroom carousel or a
 * mobile feed card on home, market, business or tourism/events), cards keep
 * auto-playing as they come into focus; after the user presses pause, no card
 * auto-plays until the user presses play again. Persisted across sessions.
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
