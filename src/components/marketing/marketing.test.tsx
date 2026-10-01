import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PointerGlow } from "./pointer-glow";
import { Reveal } from "./reveal";
import { SpotlightCard } from "./spotlight-card";
import { VideoShowcase } from "./video-showcase";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Reveal", () => {
  it("renders its content and stays visible when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(
      <Reveal className="extra" delay={120}>
        <p>Hello</p>
      </Reveal>
    );
    const wrapper = screen.getByText("Hello").parentElement!;
    expect(wrapper).toHaveClass("reveal", "extra");
    expect(wrapper).not.toHaveClass("reveal-hidden");
    expect(wrapper.style.getPropertyValue("--reveal-delay")).toBe("120ms");
  });

  it("does not hide content for visitors who prefer reduced motion", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<Reveal>content</Reveal>);
    expect(screen.getByText("content")).not.toHaveClass("reveal-hidden");
  });
});

describe("SpotlightCard", () => {
  it("passes the pointer position to the glow", () => {
    render(<SpotlightCard as="li">card</SpotlightCard>);
    const card = screen.getByText("card");
    expect(card).toHaveClass("spotlight");
    fireEvent.pointerMove(card, { clientX: 30, clientY: 40 });
    expect(card.style.getPropertyValue("--mx")).toBe("30px");
    expect(card.style.getPropertyValue("--my")).toBe("40px");
  });
});

describe("PointerGlow", () => {
  it("feeds --mx / --my to the hovered .spotlight element", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    render(
      <>
        <PointerGlow />
        <div className="spotlight" data-testid="card">
          <span>inner</span>
        </div>
      </>
    );
    const event = new MouseEvent("pointermove", { bubbles: true, clientX: 12, clientY: 18 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    screen.getByText("inner").dispatchEvent(event);
    expect(screen.getByTestId("card").style.getPropertyValue("--mx")).toBe("12px");
  });

  it("does nothing on devices without hover", () => {
    const add = vi.spyOn(document, "addEventListener");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<PointerGlow />);
    expect(add).not.toHaveBeenCalledWith("pointermove", expect.anything(), expect.anything());
  });
});

describe("VideoShowcase", () => {
  it("shows a clearly labelled example video post that can be played and paused", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<VideoShowcase />);

    expect(
      screen.getByText("Illustration of a video post, not a real listing.")
    ).toBeInTheDocument();
    expect(screen.getByText("2019 hatchback, one owner")).toBeInTheDocument();
    expect(screen.getByText("0:00 / 0:12")).toBeInTheDocument();

    const play = screen.getByRole("button", { name: "Play the example video" });
    expect(play).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(play);
    expect(screen.getByRole("button", { name: "Pause the example video" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
