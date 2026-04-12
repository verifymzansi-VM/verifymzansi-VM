import { describe, expect, it } from "vitest";
import { useVideoMuteStore } from "./video-mute-store";

describe("useVideoMuteStore", () => {
  it("defaults to muted", () => {
    const state = useVideoMuteStore.getState();
    expect(state.isMuted).toBe(true);
  });

  it("toggles mute state", () => {
    const store = useVideoMuteStore;
    store.getState().setMuted(true);
    store.getState().toggleMute();
    expect(store.getState().isMuted).toBe(false);
    store.getState().toggleMute();
    expect(store.getState().isMuted).toBe(true);
  });

  it("sets muted explicitly", () => {
    const store = useVideoMuteStore;
    store.getState().setMuted(false);
    expect(store.getState().isMuted).toBe(false);
    store.getState().setMuted(true);
    expect(store.getState().isMuted).toBe(true);
  });
});
