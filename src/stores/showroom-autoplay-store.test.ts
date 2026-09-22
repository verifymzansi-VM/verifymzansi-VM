/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { useShowroomAutoplayStore } from "./showroom-autoplay-store";

describe("showroom autoplay store", () => {
  beforeEach(() => {
    useShowroomAutoplayStore.setState({ autoplayEnabled: false });
  });

  it("defaults to disabled so showroom cards start paused", () => {
    expect(useShowroomAutoplayStore.getState().autoplayEnabled).toBe(false);
  });

  it("sticks to enabled after the user presses play", () => {
    useShowroomAutoplayStore.getState().setAutoplayEnabled(true);
    expect(useShowroomAutoplayStore.getState().autoplayEnabled).toBe(true);
  });

  it("sticks to disabled after the user presses pause", () => {
    useShowroomAutoplayStore.getState().setAutoplayEnabled(true);
    useShowroomAutoplayStore.getState().setAutoplayEnabled(false);
    expect(useShowroomAutoplayStore.getState().autoplayEnabled).toBe(false);
  });
});
