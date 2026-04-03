import { create } from "zustand";
import { persist } from "zustand/middleware";

interface VideoMuteState {
  isMuted: boolean;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
}

export const useVideoMuteStore = create<VideoMuteState>()(
  persist(
    (set) => ({
      isMuted: true,
      toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
      setMuted: (muted: boolean) => set({ isMuted: muted }),
    }),
    {
      name: "vmz-video-muted",
      // Only persist the isMuted boolean, not the actions
      partialize: (state) => ({ isMuted: state.isMuted }),
    }
  )
);
