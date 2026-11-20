/**
 * @vitest-environment jsdom
 */
import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SEEK_KEY_STEP_SECONDS, SEEK_TARGET_PX, VideoSeekBar } from "./video-seek-bar";

type Point = { clientX: number; clientY: number };

function touch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  target: Element,
  point: Point
) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: Point[];
    changedTouches: Point[];
  };
  const lifted = type === "touchend" || type === "touchcancel";
  Object.defineProperty(event, "touches", { value: lifted ? [] : [point] });
  Object.defineProperty(event, "changedTouches", { value: [point] });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const at = (clientX: number, clientY = 12): Point => ({ clientX, clientY });

function renderBar(duration = 40, currentTime = 0) {
  const onSeek = vi.fn();
  render(<VideoSeekBar currentTime={currentTime} duration={duration} onSeek={onSeek} />);
  const bar = screen.getByRole("slider", { name: "Seek playback" });
  bar.getBoundingClientRect = () =>
    ({ left: 100, width: 200, top: 0, height: 24, right: 300, bottom: 24 }) as DOMRect;
  return { bar, onSeek };
}

/** The bar as a player uses it: the position follows each seek. */
function Player({ onSeek, start = 20 }: { onSeek: (time: number) => void; start?: number }) {
  const [time, setTime] = useState(start);
  return (
    <VideoSeekBar
      currentTime={time}
      duration={40}
      onSeek={(next) => {
        onSeek(next);
        setTime(next);
      }}
    />
  );
}

describe("VideoSeekBar", () => {
  it("gives the seek control a touch and click area at least 24 px high", () => {
    render(<VideoSeekBar currentTime={12} duration={45} onSeek={() => {}} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(SEEK_TARGET_PX).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(window.getComputedStyle(bar).height)).toBeGreaterThanOrEqual(24);
    // Vertical movement still scrolls the page.
    expect(bar).toHaveClass("touch-pan-y");
    expect(bar).not.toHaveClass("touch-none");
  });

  it("shows a focus ring like the other video controls", () => {
    render(<VideoSeekBar currentTime={12} duration={45} onSeek={() => {}} />);
    expect(screen.getByRole("slider", { name: "Seek playback" })).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-brand-gold-300"
    );
  });

  it("states the position and length for screen readers", () => {
    render(<VideoSeekBar currentTime={12} duration={45} onSeek={() => {}} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    expect(bar).toHaveAttribute("aria-valuetext", "0:12 of 0:45");
    expect(bar).toHaveAttribute("max", "45");
    expect(bar).toHaveValue("12");
  });

  it("seeks when the slider moves by mouse", () => {
    const { bar, onSeek } = renderBar(45);
    fireEvent.change(bar, { target: { value: "30" } });
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it("leaves a vertical swipe to the page: no seek and no preventDefault", () => {
    const { bar, onSeek } = renderBar();
    expect(touch("touchstart", bar, at(150)).defaultPrevented).toBe(false);
    // The browser's own slider jumps to the finger on touch down; that is ignored.
    fireEvent.change(bar, { target: { value: "10" } });
    expect(touch("touchmove", bar, at(152, 30)).defaultPrevented).toBe(false);
    expect(touch("touchmove", bar, at(155, 120)).defaultPrevented).toBe(false);
    expect(touch("touchend", bar, at(155, 120)).defaultPrevented).toBe(false);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("follows a sideways drag anywhere on the bar and keeps it from the page", () => {
    const { bar, onSeek } = renderBar();
    touch("touchstart", bar, at(150));
    expect(onSeek).not.toHaveBeenCalled();

    // Small movements pick no axis yet.
    expect(touch("touchmove", bar, at(155)).defaultPrevented).toBe(false);
    expect(onSeek).not.toHaveBeenCalled();

    expect(touch("touchmove", bar, at(250, 15)).defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(30);

    // Once sideways, the drag keeps the bar even if the finger drifts.
    expect(touch("touchmove", bar, at(200, 60)).defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(20);

    // Past either end it stops at the start or the end.
    touch("touchmove", bar, at(20));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    touch("touchmove", bar, at(999));
    expect(onSeek).toHaveBeenLastCalledWith(40);

    touch("touchend", bar, at(999));
    expect(onSeek).toHaveBeenCalledTimes(4);
  });

  it("jumps on a tap when the finger lifts, not when it lands", () => {
    const { bar, onSeek } = renderBar();
    expect(touch("touchstart", bar, at(150)).defaultPrevented).toBe(false);
    expect(onSeek).not.toHaveBeenCalled();
    touch("touchend", bar, at(152));
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenLastCalledWith(10.4);
  });

  it("does nothing on touch before the video's length is known, and never blocks the page", () => {
    const { bar, onSeek } = renderBar(0);
    expect(touch("touchstart", bar, at(150)).defaultPrevented).toBe(false);
    expect(touch("touchmove", bar, at(250)).defaultPrevented).toBe(false);
    expect(touch("touchend", bar, at(250)).defaultPrevented).toBe(false);
    touch("touchstart", bar, at(150));
    touch("touchend", bar, at(150));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("forgets a cancelled touch", () => {
    const { bar, onSeek } = renderBar();
    touch("touchstart", bar, at(150));
    touch("touchcancel", bar, at(150));
    touch("touchmove", bar, at(250));
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("moves 5 seconds per arrow key press and keeps Home and End", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<Player onSeek={onSeek} />);
    const bar = screen.getByRole("slider", { name: "Seek playback" });
    await user.click(bar);
    onSeek.mockClear();

    await user.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenLastCalledWith(20 + SEEK_KEY_STEP_SECONDS);
    expect(bar).toHaveValue("25");
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(10);
    expect(bar).toHaveValue("10");
    // Never before the start or past the end.
    await user.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(onSeek).toHaveBeenLastCalledWith(0);
    expect(SEEK_KEY_STEP_SECONDS).toBe(5);

    // Home and End stay with the browser's slider.
    expect(fireEvent.keyDown(bar, { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(bar, { key: "End" })).toBe(true);
    // Arrow keys are taken over, so the slider's own 0.1 s step never applies.
    expect(fireEvent.keyDown(bar, { key: "ArrowRight" })).toBe(false);
  });

  it("moves no further than the end with the arrow keys", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<Player onSeek={onSeek} start={38} />);
    await user.click(screen.getByRole("slider", { name: "Seek playback" }));
    onSeek.mockClear();
    await user.keyboard("{ArrowRight}");
    expect(onSeek).toHaveBeenLastCalledWith(40);
  });
});
