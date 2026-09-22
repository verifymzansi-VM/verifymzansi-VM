import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ShowroomAutoplayState {
  autoplayEnabled: boolean;
  setAutoplayEnabled: (enabled: boolean) => void;
}

/**
 * Sticky showroom playback intent — the play/pause control on showroom
 * carousel cards behaves like the global mute button: after the user presses
 * play, newly focused showroom cards keep auto-playing (desktop and mobile);
 * after the user presses pause, no showroom card auto-plays until the user
 * presses play again. Persisted across sessions, like the mute preference.
 */
export const useShowroomAutoplayStore = create<ShowroomAutoplayState>()(
  persist(
    (set) => ({
      autoplayEnabled: false,
      setAutoplayEnabled: (enabled: boolean) => set({ autoplayEnabled: enabled }),
    }),
    {
      name: "vmz-showroom-autoplay",
      // Only persist the autoplayEnabled boolean, not the actions
      partialize: (state) => ({ autoplayEnabled: state.autoplayEnabled }),
    }
  )
);
