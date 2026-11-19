/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  SEARCH_MAX_OFFSET,
  SEARCH_MAX_PAGES,
  searchDepthNotice,
  searchLastPage,
  searchPagination,
} from "./search-depth";

describe("search depth", () => {
  it("stops page links at 100 pages and never past the database's offset", () => {
    expect([SEARCH_MAX_PAGES, SEARCH_MAX_OFFSET]).toEqual([100, 4800]);
    expect(searchLastPage(24)).toBe(100);
    expect(searchLastPage(12)).toBe(100);
    expect(searchLastPage(48)).toBe(100);
    expect(searchLastPage(50)).toBe(96);
    for (let size = 1; size <= 50; size++) {
      const last = searchLastPage(size);
      // Reads start at the page's first result and every 48 after it.
      const deepest = (last - 1) * size + 48 * Math.floor((size - 1) / 48);
      expect(deepest).toBeLessThanOrEqual(SEARCH_MAX_OFFSET);
    }
  });

  it("offers every page when the results fit, and says how far the links reach otherwise", () => {
    expect(searchPagination(0, 24)).toEqual({ totalPages: 0, limitedTo: null });
    expect(searchPagination(70, 24)).toEqual({ totalPages: 3, limitedTo: null });
    expect(searchPagination(2400, 24)).toEqual({ totalPages: 100, limitedTo: null });
    expect(searchPagination(2401, 24)).toEqual({ totalPages: 100, limitedTo: 2400 });
    expect(searchPagination(9000, 12)).toEqual({ totalPages: 100, limitedTo: 1200 });
  });

  it("asks the visitor to narrow the search", () => {
    expect(searchDepthNotice(2400).replace(/\s/g, " ")).toBe(
      "Showing the first 2 400 results. Narrow your search to see more."
    );
  });
});
