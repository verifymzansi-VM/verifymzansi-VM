import { create } from "zustand";
import type {
  MarketplaceArea,
  BusinessType,
  BusinessCategory,
  ListingCondition,
} from "@/types/enums";

export interface MarketplaceFilters {
  category?: string;
  province?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: ListingCondition;
  sort: "newest" | "price_asc" | "price_desc" | "popular";
  query?: string;
  /** Dynamic category-specific attribute filters (matches listing attributes JSON column) */
  attributes: Record<string, string | boolean | string[] | undefined>;
  /** Mzansi Business specific filters */
  businessType?: BusinessType;
  businessCategory?: BusinessCategory;
  businessSubcategory?: string;
}

export function cloneMarketplaceFilters(
  filters: Partial<MarketplaceFilters> = {}
): MarketplaceFilters {
  const { attributes, ...rest } = filters;
  return {
    sort: "newest",
    ...rest,
    attributes: { ...(attributes ?? {}) },
  };
}

interface MarketplaceState {
  activeArea: MarketplaceArea;
  filters: MarketplaceFilters;
  page: number;
  isSearching: boolean;

  setActiveArea: (area: MarketplaceArea) => void;
  hydrateFilters: (
    area: MarketplaceArea,
    filters: Partial<MarketplaceFilters>,
    page?: number
  ) => void;
  replaceFilters: (filters: Partial<MarketplaceFilters>, page?: number) => void;
  setFilter: <K extends keyof MarketplaceFilters>(key: K, value: MarketplaceFilters[K]) => void;
  setAttribute: (name: string, value: string | boolean | string[] | undefined) => void;
  resetFilters: () => void;
  setPage: (page: number) => void;
  setSearching: (searching: boolean) => void;
}

export const useMarketplaceStore = create<MarketplaceState>((set) => ({
  activeArea: "MZANSI_MARKET",
  filters: cloneMarketplaceFilters(),
  page: 1,
  isSearching: false,

  setActiveArea: (activeArea) => set({ activeArea, filters: cloneMarketplaceFilters(), page: 1 }),
  hydrateFilters: (activeArea, filters, page = 1) =>
    set({
      activeArea,
      filters: cloneMarketplaceFilters(filters),
      page,
    }),
  replaceFilters: (filters, page = 1) =>
    set({
      filters: cloneMarketplaceFilters(filters),
      page,
    }),
  setFilter: (key, value) =>
    set((state) => {
      const next = { ...state.filters, [key]: value };
      // Clear attribute filters when category changes
      if (key === "category") {
        next.attributes = {};
      }
      // Clear subcategory when business category changes
      if (key === "businessCategory") {
        next.businessSubcategory = undefined;
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
      filters: cloneMarketplaceFilters(),
      page: 1,
    }),
  setPage: (page) => set({ page }),
  setSearching: (isSearching) => set({ isSearching }),
}));
