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
  it("shows the active video's time and length and seeks it", () => {
    const { video, position } = mountVideo(45, 12);
    render(<VideoModeSeek />);
    expect(screen.getByText("0:12 / 0:45")).toBeInTheDocument();

    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(Number.parseFloat(window.getComputedStyle(bar).height)).toBeGreaterThanOrEqual(24);
    fireEvent.change(bar, { target: { value: "30" } });
    expect(position()).toBe(30);
    expect(screen.getByText("0:30 / 0:45")).toBeInTheDocument();

    // Playback moving on updates the label.
    video.currentTime = 31;
    act(() => {
      video.dispatchEvent(new Event("timeupdate"));
    });
    expect(screen.getByText("0:31 / 0:45")).toBeInTheDocument();
  });

  it("follows a video element that appears after it (a retry)", () => {
    render(<VideoModeSeek />);
    expect(screen.getByText("0:00 / 0:00")).toBeInTheDocument();
    const { video } = mountVideo(20, 0);
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(screen.getByText("0:00 / 0:20")).toBeInTheDocument();
  });

  it("ignores other videos on the page", () => {
    const other = document.createElement("video");
    Object.defineProperty(other, "duration", { configurable: true, get: () => 99 });
    document.body.append(other);
    render(<VideoModeSeek />);
    act(() => {
      other.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(screen.getByText("0:00 / 0:00")).toBeInTheDocument();
  });
});
