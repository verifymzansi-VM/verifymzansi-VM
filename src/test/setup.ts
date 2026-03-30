import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock out `server-only` so server modules can be imported in jsdom tests
vi.mock("server-only", () => ({}));

// Polyfill IntersectionObserver for jsdom (not available in jsdom by default)
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(private callback: IntersectionObserverCallback) {}
    observe() {
      // Immediately trigger as visible in tests
      this.callback(
        [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as globalThis.IntersectionObserver
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

if (typeof HTMLMediaElement !== "undefined") {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    value: vi.fn().mockResolvedValue(undefined),
    writable: true,
    configurable: true,
  });

  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });

  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}
