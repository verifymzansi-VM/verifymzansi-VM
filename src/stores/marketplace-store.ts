import { create } from "zustand";
import type {
  MarketplaceArea,
  BusinessType,
  BusinessCategory,
  ListingCondition,
} from "@/types/enums";

interface Filters {
  category?: string;
  province?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: ListingCondition;
  sort: "newest" | "price_asc" | "price_desc" | "popular";
  query?: string;
  /** Dynamic category-specific attribute filters (matches listing attributes JSON column) */
  attributes: Record<string, string | boolean | undefined>;
  /** Mzansi Business specific filters */
  businessType?: BusinessType;
  businessCategory?: BusinessCategory;
  mall?: string;
}

interface MarketplaceState {
  activeArea: MarketplaceArea;
  filters: Filters;
  page: number;
  isSearching: boolean;

  setActiveArea: (area: MarketplaceArea) => void;
  hydrateFilters: (area: MarketplaceArea, filters: Partial<Filters>, page?: number) => void;
  setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  setAttribute: (name: string, value: string | boolean | undefined) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  setSearching: (searching: boolean) => void;
}

const defaultFilters: Filters = {
  sort: "newest",
  attributes: {},
};

export const useMarketplaceStore = create<MarketplaceState>((set) => ({
  activeArea: "MZANSI_MARKET",
  filters: { ...defaultFilters },
  page: 1,
  isSearching: false,

  setActiveArea: (activeArea) => set({ activeArea, filters: { ...defaultFilters }, page: 1 }),
  hydrateFilters: (activeArea, filters, page = 1) =>
    set({
      activeArea,
      filters: {
        ...defaultFilters,
        ...filters,
        attributes: filters.attributes ?? {},
      },
      page,
    }),
  setFilter: (key, value) =>
    set((state) => {
      const next = { ...state.filters, [key]: value };
      // Clear attribute filters when category changes
      if (key === "category") {
        next.attributes = {};
        next.condition = undefined;
      }
      // Clear city when province changes
      if (key === "province") {
        next.city = undefined;
      }
      return { filters: next, page: 1 };
    }),
  setAttribute: (name, value) =>
    set((state) => ({
      filters: {
        ...state.filters,
        attributes: { ...state.filters.attributes, [name]: value },
      },
      page: 1,
    })),
  resetFilters: () =>
    set({
      filters: {
        ...defaultFilters,
        attributes: {},
        businessType: undefined,
        businessCategory: undefined,
        mall: undefined,
      },
      page: 1,
    }),
  setPage: (page) => set({ page }),
  setSearching: (isSearching) => set({ isSearching }),
}));
