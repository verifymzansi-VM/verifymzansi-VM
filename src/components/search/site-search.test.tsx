import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SiteSearch } from "./site-search";

/** Content searches only; the Business Sponsor list is fetched separately. */
function contentCalls(fetcher: { mock: { calls: unknown[][] } }) {
  return fetcher.mock.calls.filter(([url]) =>
    /^\/api\/(listings|businesses|promotions)\?/.test(String(url))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SiteSearch", () => {
  it.each(["!!!", "   ", "🔎"])("does not send an unsearchable query: %s", (query) => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query={query} />);
    expect(contentCalls(fetcher)).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Enter at least one letter or number");
  });

  it("offers retry when a request stalls and aborts the requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url, options) => {
        if (String(url).startsWith("/api/organisations/")) return new Promise(() => {});
        signals.push(options.signal);
        return new Promise(() => {});
      })
    );
    render(<SiteSearch query="car" />);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("handles malformed results without crashing the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          listings: [null],
          businesses: [{ id: "bad", title: {} }],
          promotions: [],
          total: "invalid",
        }),
      })
    );
    render(<SiteSearch query="car" />);
    expect(await screen.findAllByRole("button", { name: "Retry" })).toHaveLength(3);
  });
  it("does not fetch until a search is submitted and exposes a GET search form", () => {
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="" />);
    expect(contentCalls(fetcher)).toHaveLength(0);
    expect(screen.getByRole("search")).toHaveAttribute("action", "/search");
    expect(screen.getByRole("searchbox")).toHaveAttribute("name", "q");
  });

  it("searches every public content source and links to the correct detail pages", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const key = new URL(input, "https://example.com").pathname.split("/").pop()!;
      return {
        ok: true,
        json: async () => ({
          [key]: [
            {
              id: key,
              title: `${key} match`,
              business_name: key === "businesses" ? "businesses match" : undefined,
              category: "tourism_hospitality",
            },
          ],
          total: 1,
        }),
      };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="guest house" />);
    expect(await screen.findByRole("link", { name: "listings match" })).toHaveAttribute(
      "href",
      "/listing/listings"
    );
    expect(await screen.findByRole("link", { name: "businesses match" })).toHaveAttribute(
      "href",
      "/tourism-events/businesses"
    );
    expect(await screen.findByRole("link", { name: "promotions match" })).toHaveAttribute(
      "href",
      "/tourism-events/promotions"
    );
    expect(contentCalls(fetcher)).toHaveLength(3);
    expect(
      contentCalls(fetcher).every(
        ([url]) =>
          new URL(String(url), "https://example.com").searchParams.get("q") === "guest house"
      )
    ).toBe(true);
  });

  it("keeps website matches available when a content search fails and retries that source", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Offline"));
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="privacy" />);
    expect(screen.getByRole("link", { name: /Privacy Policy/ })).toHaveAttribute(
      "href",
      "/privacy"
    );
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(contentCalls(fetcher)).toHaveLength(4));
    expect(await within(market).findByText(/Could not search/)).toBeInTheDocument();
  });

  it("loads the next result page without repeating other source searches", async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input, "https://example.com");
      const key = url.pathname.split("/").pop()!;
      return {
        ok: true,
        json: async () => ({
          [key]: [{ id: "item", title: `Match page ${url.searchParams.get("page")}` }],
          total: key === "listings" ? 13 : 1,
        }),
      };
    });
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="car" />);
    fireEvent.click(await screen.findByRole("button", { name: "See all Mzansi Market results" }));
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Next" }));
    expect(await within(market).findByRole("link", { name: "Match page 2" })).toBeInTheDocument();
    expect(contentCalls(fetcher)).toHaveLength(4);
    expect(within(market).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("cancels old queries and resets pagination when the query changes", async () => {
    const requests: { query: string | null; page: string | null; signal: AbortSignal }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, options: { signal: AbortSignal }) => {
        const url = new URL(input, "https://example.com");
        const key = url.pathname.split("/").pop()!;
        if (!/^\/api\/(listings|businesses|promotions)$/.test(url.pathname)) return { ok: false };
        requests.push({
          query: url.searchParams.get("q"),
          page: url.searchParams.get("page"),
          signal: options.signal,
        });
        return {
          ok: true,
          json: async () => ({
            [key]: [{ id: "item", title: `${url.searchParams.get("q")} result` }],
            total: 13,
          }),
        };
      })
    );
    const view = render(<SiteSearch query="car" />);
    fireEvent.click(await screen.findByRole("button", { name: "See all Mzansi Market results" }));
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Next" }));
    await waitFor(() => expect(requests).toHaveLength(4));
    view.rerender(<SiteSearch query="bike" />);
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "bike result" })).toHaveLength(1)
    );
    expect(requests.filter((request) => request.query === "bike")).toHaveLength(3);
    expect(
      requests
        .filter((request) => request.query === "car")
        .every((request) => request.signal.aborted)
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.query === "bike")
        .every((request) => request.page === "1")
    ).toBe(true);
    expect(screen.queryByRole("link", { name: "car result" })).not.toBeInTheDocument();
  });

  it("groups results into area tabs with counts and keeps the open tab in the URL", async () => {
    const totals: Record<string, number> = { listings: 5, businesses: 0, promotions: 2 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const key = new URL(input, "https://example.com").pathname.split("/").pop()!;
        const total = totals[key] ?? 0;
        return {
          ok: true,
          json: async () => ({
            [key]: Array.from({ length: total }, (_, index) => ({
              id: `${key}-${index}`,
              title: `${key} ${index}`,
            })),
            total,
          }),
        };
      })
    );
    render(<SiteSearch query="phone" />);
    expect(
      await screen.findByRole("button", { name: "All 9 results", pressed: true })
    ).toBeInTheDocument();
    // "All" previews each area; an area with no matches is left out.
    expect(screen.getAllByRole("link", { name: /^listings / })).toHaveLength(4);
    expect(screen.queryByRole("region", { name: "Businesses" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mzansi Market 5 results" }));
    expect(screen.getAllByRole("link", { name: /^listings / })).toHaveLength(5);
    expect(screen.queryByRole("link", { name: /^promotions / })).not.toBeInTheDocument();
    expect(new URL(window.location.href).searchParams.get("area")).toBe("listings");

    fireEvent.click(screen.getByRole("button", { name: "All 9 results" }));
    expect(new URL(window.location.href).searchParams.has("area")).toBe(false);
  });

  it("shows one clear empty state when nothing matches anywhere", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const key = new URL(input, "https://example.com").pathname.split("/").pop()!;
        return { ok: true, json: async () => ({ [key]: [], total: 0 }) };
      })
    );
    render(<SiteSearch query="zzqx" province="Gauteng" />);
    expect(await screen.findByText("Nothing found for “zzqx”")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/search?q=zzqx"
    );
  });

  it("sends the location filters with every content search", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 0 }) });
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="plumber" province="KwaZulu-Natal" city="Richards Bay" />);
    await waitFor(() => expect(contentCalls(fetcher)).toHaveLength(3));
    for (const [url] of contentCalls(fetcher)) {
      const params = new URL(String(url), "https://example.com").searchParams;
      expect(params.get("province")).toBe("KwaZulu-Natal");
      expect(params.get("city")).toBe("Richards Bay");
    }
  });
});

describe("SearchBar filters", () => {
  function stubPendingFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    );
    return vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => undefined);
  }

  it("re-runs the search when a filter is picked and offers towns for the province", () => {
    const submit = stubPendingFetch();
    render(<SiteSearch query="plumber" />);
    expect(screen.queryByLabelText("Town or city")).not.toBeInTheDocument();
    const province = screen.getByLabelText("Province");
    fireEvent.pointerDown(province);
    fireEvent.change(province, { target: { value: "KwaZulu-Natal" } });
    expect(submit).toHaveBeenCalledTimes(1);
    const town = screen.getByLabelText("Town or city");
    expect(within(town).getByRole("option", { name: "Richards Bay" })).toBeInTheDocument();
    // Only filters in use are submitted.
    expect(province).toHaveAttribute("name", "province");
    expect(town).not.toHaveAttribute("name");
    submit.mockRestore();
  });

  it("applies a keyboard pick on Enter or blur, not on every arrow key", () => {
    const submit = stubPendingFetch();
    render(<SiteSearch query="plumber" />);
    const province = screen.getByLabelText("Province");
    fireEvent.keyDown(province, { key: "ArrowDown" });
    fireEvent.change(province, { target: { value: "Eastern Cape" } });
    fireEvent.keyDown(province, { key: "ArrowDown" });
    fireEvent.change(province, { target: { value: "Free State" } });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(province, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(province, { key: "ArrowDown" });
    fireEvent.change(province, { target: { value: "Gauteng" } });
    fireEvent.blur(province);
    expect(submit).toHaveBeenCalledTimes(2);
    submit.mockRestore();
  });

  it("waits for a search term and keeps the picked location on shortcut links", () => {
    const submit = stubPendingFetch();
    render(<SiteSearch query="" />);
    const province = screen.getByLabelText("Province");
    fireEvent.pointerDown(province);
    fireEvent.change(province, { target: { value: "Gauteng" } });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Plumber" })).toHaveAttribute(
      "href",
      "/search?q=Plumber&province=Gauteng"
    );
    expect(screen.getByRole("link", { name: "Vehicles" })).toHaveAttribute(
      "href",
      "/mzansi-market?category=vehicles&province=Gauteng"
    );
    submit.mockRestore();
  });
});

describe("SiteSearch area links and counts", () => {
  it("keeps the words and location when moving on to an area's own filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const key = new URL(input, "https://example.com").pathname.split("/").pop()!;
        return { ok: true, json: async () => ({ [key]: [{ id: "a", title: "match" }], total: 1 }) };
      })
    );
    render(
      <SiteSearch query="plumber" province="KwaZulu-Natal" city="Richards Bay" area="listings" />
    );
    expect(
      await screen.findByRole("link", { name: /More filters in Mzansi Market/ })
    ).toHaveAttribute("href", "/mzansi-market?q=plumber&province=KwaZulu-Natal&city=Richards+Bay");
  });

  it("totals the areas that answered when another area fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const key = new URL(input, "https://example.com").pathname.split("/").pop()!;
        if (key === "promotions") throw new Error("Offline");
        return { ok: true, json: async () => ({ [key]: [{ id: key, title: key }], total: 2 }) };
      })
    );
    render(<SiteSearch query="zzqx" />);
    expect(await screen.findByRole("button", { name: "All 4 results" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tourism & Events ! search failed" })
    ).toBeInTheDocument();
  });
});
