import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessStorefront } from "./business-storefront";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const card = (n: number) => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
  title: `Car ${n}`,
  price: "R100 000",
  image: null,
  hasVideo: false,
  facts: "2019 · Manual",
});
const row = (n: number) => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`,
  title: `Car ${n}`,
  category: "vehicles",
  price_cents: 10000000,
  price_mode: "amount",
  video_thumbnail: null,
  photos: [],
  videos: [],
  attributes: { year: 2020, transmission: "automatic" },
});
const summary = (categories: Record<string, number>, extra = {}) => ({
  businessId: BUSINESS,
  businessName: "Sample Motors",
  listings: 30,
  categories,
  makes: ["Toyota", "Volkswagen"],
  areas: [{ province: "kzn", city: "kzn_richards_bay" }],
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("BusinessStorefront", () => {
  it("shows the stock with the vehicle filters, and reads a filtered page", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ listings: [row(9)], total: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BusinessStorefront
        storefront={summary({ vehicles: 30 })}
        areaLabels={{}}
        initial={{ cards: [card(1), card(2)], total: 30 }}
      />
    );
    expect(screen.getByRole("heading", { name: /All stock/ })).toHaveTextContent("30 cars");
    for (const label of ["Make", "Price", "Year", "Gearbox"])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Make"), { target: { value: "Toyota" } });
    await waitFor(() => expect(screen.getByText("Car 9")).toBeInTheDocument());
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/listings");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      storefront: BUSINESS,
      make: "Toyota",
      page: "1",
      limit: "24",
      sort: "newest",
    });
    expect(screen.getByText("2020 · Auto")).toBeInTheDocument();
    expect(screen.queryByText("Car 1")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("adds the next page with Show more", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ listings: [row(3)], total: 3 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BusinessStorefront
        storefront={summary({ vehicles: 3 })}
        areaLabels={{}}
        initial={{ cards: [card(1), card(2)], total: 3 }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getByText("Car 3")).toBeInTheDocument());
    expect(screen.getByText("Car 1")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page=2");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("uses the property filters for a property storefront, and says when a read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    render(
      <BusinessStorefront
        storefront={summary({ property: 4 }, { listings: 4 })}
        areaLabels={{ "kzn:kzn_richards_bay": "Richards Bay" }}
        initial={{ cards: [card(1)], total: 4 }}
      />
    );
    expect(screen.getByRole("heading", { name: /All stock/ })).toHaveTextContent("4 properties");
    for (const label of ["For sale or to rent", "Area", "Price", "Bedrooms"])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Richards Bay" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Bedrooms"), { target: { value: "3" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Stock could not be loaded");
  });
});
