/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { useVideoAutoplayStore } from "./video-autoplay-store";

describe("video autoplay store", () => {
  beforeEach(() => {
    useVideoAutoplayStore.setState({ autoplayEnabled: false });
  });

  it("defaults to disabled so cards start paused", () => {
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(false);
  });

  it("sticks to enabled after the user presses play", () => {
    useVideoAutoplayStore.getState().setAutoplayEnabled(true);
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(true);
  });

  it("sticks to disabled after the user presses pause", () => {
    useVideoAutoplayStore.getState().setAutoplayEnabled(true);
    useVideoAutoplayStore.getState().setAutoplayEnabled(false);
    expect(useVideoAutoplayStore.getState().autoplayEnabled).toBe(false);
  });
});
