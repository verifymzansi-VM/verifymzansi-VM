/**
 * @vitest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SEEK_TARGET_PX, VideoSeekBar } from "./video-seek-bar";

function touch(type: "touchstart" | "touchmove", target: Element, clientX: number) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: Array<{ clientX: number }>;
  };
  Object.defineProperty(event, "touches", { value: [{ clientX }] });
  target.dispatchEvent(event);
  return event;
}

describe("VideoSeekBar", () => {
  it("gives the seek control a touch and click area at least 24 px high", () => {
    render(<VideoSeekBar currentTime={12} duration={45} onSeek={() => {}} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(SEEK_TARGET_PX).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(window.getComputedStyle(bar).height)).toBeGreaterThanOrEqual(24);
    // The page does not scroll or swipe while a finger drags it.
    expect(bar).toHaveClass("touch-none");
  });

  it("states the position and length for screen readers", () => {
    render(<VideoSeekBar currentTime={12} duration={45} onSeek={() => {}} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(bar).toHaveAttribute("aria-valuetext", "0:12 of 0:45");
    expect(bar).toHaveAttribute("max", "45");
    expect(bar).toHaveValue("12");
  });

  it("seeks when the slider moves by mouse or keyboard", () => {
    const onSeek = vi.fn();
    render(<VideoSeekBar currentTime={0} duration={45} onSeek={onSeek} />);
    fireEvent.change(screen.getByRole("slider", { name: "Seek playback" }), {
      target: { value: "30" },
    });
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("follows the finger anywhere on the bar and keeps the gesture from the page", () => {
    const onSeek = vi.fn();
    render(<VideoSeekBar currentTime={0} duration={40} onSeek={onSeek} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    bar.getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, height: 24, right: 300, bottom: 24 }) as DOMRect;

    const start = touch("touchstart", bar, 150);
    expect(start.defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(10);

    touch("touchmove", bar, 250);
    expect(onSeek).toHaveBeenLastCalledWith(30);

    // Past either end it stops at the start or the end.
    touch("touchmove", bar, 20);
    expect(onSeek).toHaveBeenLastCalledWith(0);
    touch("touchmove", bar, 999);
    expect(onSeek).toHaveBeenLastCalledWith(40);
  });

  it("does nothing on touch before the video's length is known", () => {
    const onSeek = vi.fn();
    render(<VideoSeekBar currentTime={0} duration={0} onSeek={onSeek} />);
    touch("touchstart", screen.getByRole("slider", { name: "Seek playback" }), 150);
    expect(onSeek).not.toHaveBeenCalled();
  });
});
