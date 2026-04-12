import { describe, it, expect } from "vitest";
import {
  getFocalPositionClassName,
  getProgressWidthClassName,
} from "@/lib/utils/media-position-classes";

describe("getFocalPositionClassName", () => {
  it("returns undefined when focalX is null", () => {
    expect(getFocalPositionClassName(null, 0.5)).toBeUndefined();
  });

  it("returns undefined when focalY is null", () => {
    expect(getFocalPositionClassName(0.5, null)).toBeUndefined();
  });

  it("returns undefined when both are undefined", () => {
    expect(getFocalPositionClassName()).toBeUndefined();
  });

  it("returns class with 50/50 for normal 0.5/0.5 values", () => {
    expect(getFocalPositionClassName(0.5, 0.5)).toBe("focal-pos-x-50 focal-pos-y-50");
  });

  it("returns class with 0/0 for 0/0 values", () => {
    expect(getFocalPositionClassName(0, 0)).toBe("focal-pos-x-0 focal-pos-y-0");
  });

  it("returns class with 100/100 for 1/1 values", () => {
    expect(getFocalPositionClassName(1, 1)).toBe("focal-pos-x-100 focal-pos-y-100");
  });

  it("clamps at 100 when value exceeds 1", () => {
    expect(getFocalPositionClassName(1.5, 1.5)).toBe("focal-pos-x-100 focal-pos-y-100");
  });

  it("clamps at 0 when value is negative", () => {
    expect(getFocalPositionClassName(-0.5, -0.5)).toBe("focal-pos-x-0 focal-pos-y-0");
  });

  it("falls back to 50 when value is Infinity", () => {
    expect(getFocalPositionClassName(Infinity, Infinity)).toBe("focal-pos-x-50 focal-pos-y-50");
  });

  it("falls back to 50 when value is NaN", () => {
    expect(getFocalPositionClassName(NaN, NaN)).toBe("focal-pos-x-50 focal-pos-y-50");
  });
});

describe("getProgressWidthClassName", () => {
  it("returns progress-w-0 when progress is undefined", () => {
    expect(getProgressWidthClassName()).toBe("progress-w-0");
  });

  it("rounds fractional progress values before clamping", () => {
    expect(getProgressWidthClassName(0.5)).toBe("progress-w-1");
  });

  it("returns progress-w-50 for 50", () => {
    expect(getProgressWidthClassName(50)).toBe("progress-w-50");
  });

  it("clamps to 0 for negative values", () => {
    expect(getProgressWidthClassName(-10)).toBe("progress-w-0");
  });

  it("clamps to 100 for values above 100", () => {
    expect(getProgressWidthClassName(150)).toBe("progress-w-100");
  });
});
