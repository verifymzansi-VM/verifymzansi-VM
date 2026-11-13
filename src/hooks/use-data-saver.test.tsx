/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { prefersNoVideoAutoplay, readDataSaverPreference, useDataSaver } from "./use-data-saver";

function setMatchingMediaQueries(queries: string[]) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: queries.includes(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function setConnection(connection: { saveData?: boolean } | undefined) {
  Object.defineProperty(navigator, "connection", { configurable: true, value: connection });
}

describe("data saver preference", () => {
  afterEach(() => {
    setConnection(undefined);
    setMatchingMediaQueries([]);
  });

  it("is off when the browser reports nothing", () => {
    setConnection(undefined);
    setMatchingMediaQueries([]);
    expect(readDataSaverPreference()).toBe(false);
    expect(prefersNoVideoAutoplay()).toBe(false);
    expect(renderHook(() => useDataSaver()).result.current).toBe(false);
  });

  it("follows the Save-Data setting", () => {
    setConnection({ saveData: true });
    expect(readDataSaverPreference()).toBe(true);
    expect(prefersNoVideoAutoplay()).toBe(true);
    expect(renderHook(() => useDataSaver()).result.current).toBe(true);
  });

  it("follows prefers-reduced-data where supported", () => {
    setMatchingMediaQueries(["(prefers-reduced-data: reduce)"]);
    expect(readDataSaverPreference()).toBe(true);
    expect(renderHook(() => useDataSaver()).result.current).toBe(true);
  });

  it("blocks automatic video for reduced motion without counting it as data saving", () => {
    setMatchingMediaQueries(["(prefers-reduced-motion: reduce)"]);
    expect(readDataSaverPreference()).toBe(false);
    expect(prefersNoVideoAutoplay()).toBe(true);
  });
});
