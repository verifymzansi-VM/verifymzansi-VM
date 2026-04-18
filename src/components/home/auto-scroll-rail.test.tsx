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
  let capturedPointerId: number | null = null;
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
  Object.defineProperty(rail, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 24 }),
  });
  Object.defineProperty(rail, "setPointerCapture", {
    configurable: true,
    value: vi.fn((pointerId: number) => {
      capturedPointerId = pointerId;
    }),
  });
  Object.defineProperty(rail, "releasePointerCapture", {
    configurable: true,
    value: vi.fn((pointerId: number) => {
      if (capturedPointerId === pointerId) {
        capturedPointerId = null;
      }
    }),
  });
  Object.defineProperty(rail, "hasPointerCapture", {
    configurable: true,
    value: vi.fn((pointerId: number) => capturedPointerId === pointerId),
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

function RailLinkProbe({
  label,
  onClick,
}: {
  label: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a href={`/${label}`} data-testid={`rail-link-${label}`} onClick={onClick}>
      {label}
    </a>
  );
}

function RailControlProbe({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" data-carousel-control="true" onClick={onClick}>
      Control
    </button>
  );
}

describe("AutoScrollRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", matchMediaMock);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as Partial<Window>).matchMedia;
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

    fireEvent.pointerDown(rail, { pointerType: "mouse", button: 0, clientX: 120, pointerId: 1 });
    fireEvent.pointerMove(rail, { pointerType: "mouse", clientX: 180, pointerId: 1 });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerUp(rail, { pointerType: "mouse", pointerId: 1 });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "false");
  });

  it("supports desktop dragging that begins on a nested card link surface", () => {
    render(
      <AutoScrollRail ariaLabel="Nested link rail">
        <RailLinkProbe label="one" />
        <RailLinkProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Nested link rail") as HTMLDivElement;
    mockRailLayout(rail, 240);
    const link = screen.getByTestId("rail-link-one");

    fireEvent.pointerDown(link, { pointerType: "mouse", button: 0, clientX: 180, pointerId: 7 });
    fireEvent.pointerMove(rail, { pointerType: "mouse", clientX: 120, pointerId: 7 });

    expect(rail.scrollLeft).toBe(360);

    fireEvent.pointerUp(rail, { pointerType: "mouse", pointerId: 7 });
  });

  it("suppresses click-through after a desktop drag gesture", () => {
    const clickSpy = vi.fn();

    render(
      <AutoScrollRail ariaLabel="Click suppression rail">
        <RailLinkProbe label="one" onClick={clickSpy} />
        <RailLinkProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Click suppression rail") as HTMLDivElement;
    mockRailLayout(rail, 240);
    const link = screen.getByTestId("rail-link-one");

    fireEvent.pointerDown(link, { pointerType: "mouse", button: 0, clientX: 180, pointerId: 9 });
    fireEvent.pointerMove(rail, { pointerType: "mouse", clientX: 120, pointerId: 9 });
    fireEvent.pointerUp(rail, { pointerType: "mouse", pointerId: 9 });
    fireEvent.click(link);

    expect(clickSpy).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
  });

  it("clears desktop drag state when pointer capture is cancelled", () => {
    render(
      <AutoScrollRail ariaLabel="Cancelled drag rail">
        <RailItemProbe label="one" />
        <RailItemProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Cancelled drag rail") as HTMLDivElement;
    mockRailLayout(rail, 0);

    fireEvent.pointerDown(rail, { pointerType: "mouse", button: 0, clientX: 120, pointerId: 3 });
    fireEvent.pointerMove(rail, { pointerType: "mouse", clientX: 180, pointerId: 3 });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerCancel(rail, { pointerType: "mouse", pointerId: 3 });

    expect(screen.getByTestId("rail-item-one")).toHaveAttribute("data-dragging", "false");
  });

  it("does not start dragging when the pointer down begins on a real control", () => {
    const controlClickSpy = vi.fn();

    render(
      <AutoScrollRail ariaLabel="Control-protected rail">
        <RailControlProbe onClick={controlClickSpy} />
        <RailItemProbe label="two" />
      </AutoScrollRail>
    );

    const rail = screen.getByLabelText("Control-protected rail") as HTMLDivElement;
    mockRailLayout(rail, 120);
    const control = screen.getByRole("button", { name: "Control" });

    fireEvent.pointerDown(control, {
      pointerType: "mouse",
      button: 0,
      clientX: 180,
      pointerId: 12,
    });
    fireEvent.pointerMove(rail, { pointerType: "mouse", clientX: 60, pointerId: 12 });
    fireEvent.pointerUp(rail, { pointerType: "mouse", pointerId: 12 });
    fireEvent.click(control);

    expect(rail.scrollLeft).toBe(120);
    expect(controlClickSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("rail-item-two")).toHaveAttribute("data-dragging", "false");
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
