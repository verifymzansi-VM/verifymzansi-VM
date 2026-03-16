import { describe, it, expect, vi, beforeEach } from "vitest";
import { triggerHaptic } from "./haptics";

describe("triggerHaptic", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: { vibrate: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it("calls vibrate(10) for light (default)", () => {
    triggerHaptic();
    expect(navigator.vibrate).toHaveBeenCalledWith(10);
  });

  it("calls vibrate(20) for medium", () => {
    triggerHaptic("medium");
    expect(navigator.vibrate).toHaveBeenCalledWith(20);
  });

  it("calls vibrate(30) for heavy", () => {
    triggerHaptic("heavy");
    expect(navigator.vibrate).toHaveBeenCalledWith(30);
  });

  it("calls vibrate pattern for success", () => {
    triggerHaptic("success");
    expect(navigator.vibrate).toHaveBeenCalledWith([10, 30, 20]);
  });

  it("calls vibrate pattern for error", () => {
    triggerHaptic("error");
    expect(navigator.vibrate).toHaveBeenCalledWith([20, 40, 20, 40, 30]);
  });

  it("does nothing when navigator.vibrate is missing", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(() => triggerHaptic()).not.toThrow();
  });
});
