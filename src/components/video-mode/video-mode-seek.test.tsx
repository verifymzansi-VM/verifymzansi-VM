/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VideoModeSeek } from "./video-mode-seek";

function mountVideo(duration: number, currentTime: number) {
  const video = document.createElement("video");
  video.setAttribute("data-vm-active-video", "");
  let position = currentTime;
  Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => position,
    set: (value: number) => {
      position = value;
    },
  });
  document.body.append(video);
  return { video, position: () => position };
}

afterEach(() => {
  document.querySelectorAll("video").forEach((video) => video.remove());
});

describe("VideoModeSeek", () => {
  it("states the active video's time and length and seeks it", () => {
    const { video, position } = mountVideo(45, 12);
    render(<VideoModeSeek />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(bar).toHaveAttribute("aria-valuetext", "0:12 of 0:45");
    // A quiet line, no time label on the picture.
    expect(screen.queryByText("0:12 / 0:45")).toBeNull();
    expect(Number.parseFloat(window.getComputedStyle(bar).height)).toBeGreaterThanOrEqual(24);
    fireEvent.change(bar, { target: { value: "30" } });
    expect(position()).toBe(30);
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveAttribute(
      "aria-valuetext",
      "0:30 of 0:45"
    );

    // Playback moving on updates the label.
    video.currentTime = 31;
    act(() => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveAttribute(
      "aria-valuetext",
      "0:31 of 0:45"
    );
  });

  it("follows a video element that appears after it (a retry)", () => {
    render(<VideoModeSeek />);
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveAttribute(
      "aria-valuetext",
      "0:00 of 0:00"
    );
    const { video } = mountVideo(20, 0);
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveAttribute(
      "aria-valuetext",
      "0:00 of 0:20"
    );
  });

  it("ignores other videos on the page", () => {
    const other = document.createElement("video");
    Object.defineProperty(other, "duration", { configurable: true, get: () => 99 });
    document.body.append(other);
    render(<VideoModeSeek />);
    act(() => {
      other.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveAttribute(
      "aria-valuetext",
      "0:00 of 0:00"
    );
  });
});
