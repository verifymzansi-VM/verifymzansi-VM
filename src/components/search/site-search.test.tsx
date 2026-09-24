import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SiteSearch } from "./site-search";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SiteSearch", () => {
  it.each(["!!!", "   ", "🔎"])("does not send an unsearchable query: %s", (query) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query={query} />);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Enter at least one letter or number");
  });

  it("offers retry when a request stalls and aborts the requests", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, options) => {
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
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<SiteSearch query="" />);
    expect(fetcher).not.toHaveBeenCalled();
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
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.every(
        ([url]) => new URL(url, "https://example.com").searchParams.get("q") === "guest house"
      )
    ).toBe(true);
  });

  it("keeps website matches available when a content search fails and retries that source", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    render(<SiteSearch query="privacy" />);
    expect(screen.getByRole("link", { name: /Privacy Policy/ })).toHaveAttribute(
      "href",
      "/privacy"
    );
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
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
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Next" }));
    expect(await within(market).findByRole("link", { name: "Match page 2" })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(within(market).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("cancels old queries and resets pagination when the query changes", async () => {
    const requests: { query: string | null; page: string | null; signal: AbortSignal }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, options: { signal: AbortSignal }) => {
        const url = new URL(input, "https://example.com");
        const key = url.pathname.split("/").pop()!;
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
    const market = screen.getByRole("region", { name: "Mzansi Market" });
    fireEvent.click(await within(market).findByRole("button", { name: "Next" }));
    await waitFor(() => expect(requests).toHaveLength(4));
    view.rerender(<SiteSearch query="bike" />);
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "bike result" })).toHaveLength(3)
    );
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
});
