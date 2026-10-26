import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FoundationMarketplace } from "./public-marketplace";
import { FoundationSiteSearch } from "./site-search";
import { searchFoundationCards } from "@/lib/foundation/public-cards";

vi.mock("@/lib/foundation/server-public", () => ({ foundationServerPublicApi: () => ({}) }));
vi.mock("@/lib/foundation/reference-catalogue", () => ({
  readFoundationReferenceCatalogue: async () => ({
    categories: [
      { key: "vehicles", area: "market", label: "Vehicles" },
      { key: "services", area: "business", label: "Services" },
    ],
    provinces: [{ id: "gauteng", label: "Gauteng" }],
  }),
}));
vi.mock("@/lib/foundation/public-cards", () => ({
  searchFoundationCards: vi.fn(),
  foundationMediaUrl: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchFoundationCards).mockResolvedValue({
    items: [],
    total: 0,
    facets: { categories: {} },
    sort: "newest",
    next_cursor: null,
  });
});

it("keeps website-page search local and never queries retired post endpoints", async () => {
  render(
    await FoundationSiteSearch({ searchParams: Promise.resolve({ area: "pages", q: "privacy" }) })
  );
  expect(searchFoundationCards).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
});

it("searches the new public API across all sections without using retired discovery endpoints", async () => {
  render(
    await FoundationMarketplace({
      searchParams: Promise.resolve({ q: "local service", province: "Gauteng" }),
    })
  );
  expect(searchFoundationCards).toHaveBeenLastCalledWith(
    {},
    { q: "local service", province: "gauteng", limit: 24 }
  );
  expect(screen.getByRole("heading", { name: "Search VerifyMzansi" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Section" })).toBeInTheDocument();
  expect(screen.getByText("No matching posts yet")).toBeInTheDocument();
});

it("preserves existing search links while filtering categories for the selected section", async () => {
  render(
    await FoundationMarketplace({
      searchParams: Promise.resolve({ area: "businesses", q: "repair" }),
    })
  );
  expect(searchFoundationCards).toHaveBeenLastCalledWith(
    {},
    { area: "business", q: "repair", limit: 24 }
  );
  expect(screen.getByRole("option", { name: "Services" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Vehicles" })).not.toBeInTheDocument();
});

it("keeps dedicated marketplace pages pinned to their own area despite caller-supplied filters", async () => {
  render(
    await FoundationMarketplace({
      area: "market",
      searchParams: Promise.resolve({ area: "businesses", category: "services" }),
    })
  );
  expect(searchFoundationCards).toHaveBeenLastCalledWith({}, { area: "market", limit: 24 });
  expect(screen.queryByRole("combobox", { name: "Section" })).not.toBeInTheDocument();
});

it("ignores unknown section names including object prototype properties", async () => {
  render(await FoundationMarketplace({ searchParams: Promise.resolve({ area: "__proto__" }) }));
  expect(searchFoundationCards).toHaveBeenLastCalledWith({}, { limit: 24 });
});
