import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoScrollRail, useAutoScrollRailItemState } from "./auto-scroll-rail";

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: query === HOVER_QUERY, // desktop by default: hover=true, reduced-motion=false
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

function mockRailLayout(rail: HTMLDivElement, scrollLeft: number) {
  Object.defineProperty(rail, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(rail, "clientWidth", { configurable: true, value: 300 });
  Object.defineProperty(rail, "scrollWidth", { configurable: true, value: 900 });
  Object.defineProperty(rail, "scrollLeft", {
    configurable: true,
    writable: true,
    value: scrollLeft,
  });
  Object.defineProperty(rail.firstElementChild, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 240 }),
  });
}

function RailItemProbe({ label }: { label: string }) {
  const { isActive, isRailDragging } = useAutoScrollRailItemState();
  return (
    <div
      data-testid={`rail-item-${label}`}
      data-active={isActive ? "true" : "false"}
      data-dragging={isRailDragging ? "true" : "false"}
    >
      {label}
    </div>
  );
}

describe("AutoScrollRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", matchMediaMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("auto-advances horizontally when visible", () => {
    render(
      <AutoScrollRail ariaLabel="Test rail" intervalMs={1000}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Test rail") as HTMLDivElement;
    mockRailLayout(rail, 0);
    const scrollToSpy = vi.spyOn(rail, "scrollTo").mockImplementation(() => undefined);

    vi.advanceTimersByTime(1000);

    expect(scrollToSpy).toHaveBeenCalledWith({ left: 240, behavior: "smooth" });
  });

  it("wraps back to the start when the rail reaches the end", () => {
    render(
      <AutoScrollRail ariaLabel="Wrap rail" intervalMs={1000}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Wrap rail") as HTMLDivElement;
    mockRailLayout(rail, 600);
    const scrollToSpy = vi.spyOn(rail, "scrollTo").mockImplementation(() => undefined);

    vi.advanceTimersByTime(1000);

    expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, behavior: "smooth" });
  });

  it("pauses after user interaction and resumes later", () => {
    render(
      <AutoScrollRail ariaLabel="Pause rail" intervalMs={1000} pauseAfterInteractionMs={2000}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Pause rail") as HTMLDivElement;
    mockRailLayout(rail, 0);
    const scrollToSpy = vi.spyOn(rail, "scrollTo").mockImplementation(() => undefined);

    act(() => {
      fireEvent.pointerDown(rail);
      vi.advanceTimersByTime(1000);
    });
    expect(scrollToSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ left: 240, behavior: "smooth" });
  });

  it("skips auto-advance when reduced motion is enabled", () => {
    matchMediaMock.mockImplementation((_query: string) => ({
      matches: true, // both hover and reduced-motion return true
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(
      <AutoScrollRail ariaLabel="Reduced motion rail" intervalMs={1000}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Reduced motion rail") as HTMLDivElement;
    mockRailLayout(rail, 0);
    const scrollToSpy = vi.spyOn(rail, "scrollTo").mockImplementation(() => undefined);

    vi.advanceTimersByTime(1000);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("skips auto-advance on touch-only devices", () => {
    matchMediaMock.mockImplementation((query: string) => ({
      matches: query === HOVER_QUERY ? false : false, // touch device: no hover, no reduced-motion
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(
      <AutoScrollRail ariaLabel="Touch rail" intervalMs={1000}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Touch rail") as HTMLDivElement;
    mockRailLayout(rail, 0);
    const scrollToSpy = vi.spyOn(rail, "scrollTo").mockImplementation(() => undefined);

    vi.advanceTimersByTime(1000);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("hides edge fades when disabled", () => {
    render(
      <AutoScrollRail ariaLabel="Fade-free rail" showEdgeFades={false}>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    expect(screen.queryByTestId("auto-scroll-rail-fade-left")).not.toBeInTheDocument();
    expect(screen.queryByTestId("auto-scroll-rail-fade-right")).not.toBeInTheDocument();
  });

  it("removes edge padding when flushEdges is enabled", () => {
    render(
      <AutoScrollRail ariaLabel="Flush rail" flushEdges>
        <div>First</div>
        <div>Second</div>
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Flush rail");
    expect(rail.className).toContain("mx-0");
    expect(rail.className).toContain("px-0");
    expect(rail.className).not.toContain("-mx-2");
  });

  it("tracks the centered item as the active rail item", () => {
    render(
      <AutoScrollRail ariaLabel="Active rail">
        <RailItemProbe label="one" />
        <RailItemProbe label="two" />
        <RailItemProbe label="three" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Active rail") as HTMLDivElement;
    mockRailLayout(rail, 0);

    act(() => {
      vi.runAllTimers();
    });
    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-active", "true");

    act(() => {
      rail.scrollLeft = 480;
      fireEvent.scroll(rail);
      vi.runAllTimers();
    });

    expect(screen.getByTestId("rail-item-three")).toHaveAttribute("data-active", "true");
  });

  it("marks the rail as dragging while desktop pointer dragging is active", () => {
    render(
      <AutoScrollRail ariaLabel="Dragging rail">
        <RailItemProbe label="one" />
        <RailItemProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Dragging rail") as HTMLDivElement;
    mockRailLayout(rail, 0);

    fireEvent.pointerDown(rail, { pointerType: "mouse", button: 0, pageX: 120 });
    fireEvent.pointerMove(rail, { pointerType: "mouse", pageX: 180 });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerUp(rail, { pointerType: "mouse" });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "false");
  });

  it("marks the rail as dragging immediately on touch start and clears after settle", () => {
    render(
      <AutoScrollRail ariaLabel="Touch dragging rail">
        <RailItemProbe label="one" />
        <RailItemProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Touch dragging rail") as HTMLDivElement;
    mockRailLayout(rail, 0);

    fireEvent.touchStart(rail);
    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "true");

    act(() => {
      fireEvent.touchEnd(rail);
      vi.advanceTimersByTime(150);
    });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "false");
  });
});
