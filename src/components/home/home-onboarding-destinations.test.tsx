import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HomeOnboardingDestinations,
  type HomeOnboardingDestination,
} from "./home-onboarding-destinations";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const destinations: HomeOnboardingDestination[] = [
  {
    id: "tourism-events",
    title: "Tourism & Events",
    description: "Tourism destinations, accommodations, and events near you.",
    href: "/tourism-events",
    iconKey: "tourism",
    accentClass: "text-teal-400",
    iconBgClass: "bg-teal-500/10",
  },
  {
    id: "mzansi-business",
    title: "Mzansi Business",
    description: "Verified local businesses you can trust.",
    href: "/mzansi-business",
    iconKey: "business",
    accentClass: "text-brand-blue",
    iconBgClass: "bg-brand-blue/10",
  },
  {
    id: "mzansi-market",
    title: "Mzansi Market",
    description: "Products and listings from verified sellers.",
    href: "/mzansi-market",
    iconKey: "market",
    accentClass: "text-brand-green",
    iconBgClass: "bg-brand-green/10",
  },
];

function mockCardHeights() {
  for (const link of screen.getAllByRole("link")) {
    Object.defineProperty(link, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        height: 120,
      }),
    });
  }
}

describe("HomeOnboardingDestinations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the destination cards with their links", () => {
    render(<HomeOnboardingDestinations destinations={destinations} />);

    expect(screen.getByRole("link", { name: /Mzansi Market/i })).toHaveAttribute(
      "href",
      "/mzansi-market"
    );
    expect(screen.getByRole("link", { name: /Mzansi Business/i })).toHaveAttribute(
      "href",
      "/mzansi-business"
    );
    expect(screen.getByRole("link", { name: /Tourism & Events/i })).toHaveAttribute(
      "href",
      "/tourism-events"
    );
  });

  it("reorders cards when a dragged card is moved down the stack", () => {
    render(<HomeOnboardingDestinations destinations={destinations} />);
    mockCardHeights();

    const marketCard = screen.getByRole("link", { name: /Mzansi Market/i });

    fireEvent.pointerDown(marketCard, { button: 0, pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 360 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const orderedTitles = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "")
      .join(" | ");

    expect(orderedTitles).toContain("Mzansi Business");
    expect(screen.getAllByRole("link")[2]).toHaveTextContent("Mzansi Market");
  });

  it("persists the reordered card order in session storage", () => {
    render(<HomeOnboardingDestinations destinations={destinations} />);
    mockCardHeights();

    const tourismCard = screen.getByRole("link", { name: /Tourism & Events/i });

    fireEvent.pointerDown(tourismCard, { button: 0, pointerId: 2, clientY: 320 });
    fireEvent.pointerMove(window, { pointerId: 2, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    const stored = window.sessionStorage.getItem("vmz-home-onboarding-order");
    expect(stored).toContain("tourism-events");
    expect(screen.getAllByRole("link")[0]).toHaveTextContent("Tourism & Events");
  });

  it("does not reorder on touch scroll gestures without a long press", () => {
    render(<HomeOnboardingDestinations destinations={destinations} />);
    mockCardHeights();

    const tourismCard = screen.getByRole("link", { name: /Tourism & Events/i });

    fireEvent.pointerDown(tourismCard, {
      button: 0,
      pointerId: 4,
      pointerType: "touch",
      clientY: 120,
    });

    fireEvent.pointerMove(window, {
      pointerId: 4,
      pointerType: "touch",
      clientY: 170,
    });

    fireEvent.pointerUp(window, { pointerId: 4, pointerType: "touch" });

    expect(screen.getAllByRole("link")[0]).toHaveTextContent("Tourism & Events");
  });

  it("reorders on touch only after a long press activates drag", () => {
    render(<HomeOnboardingDestinations destinations={destinations} />);
    mockCardHeights();

    const marketCard = screen.getByRole("link", { name: /Mzansi Market/i });

    fireEvent.pointerDown(marketCard, {
      button: 0,
      pointerId: 5,
      pointerType: "touch",
      clientY: 120,
    });

    act(() => {
      vi.advanceTimersByTime(320);
    });

    fireEvent.pointerMove(window, {
      pointerId: 5,
      pointerType: "touch",
      clientY: 380,
    });
    fireEvent.pointerUp(window, { pointerId: 5, pointerType: "touch" });

    expect(screen.getAllByRole("link")[2]).toHaveTextContent("Mzansi Market");
  });
});
