"use client";

import { useMarketplaceStore } from "@/stores";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import { Search, MapPin } from "lucide-react";

export function MallHero() {
  const { filters, setFilter } = useMarketplaceStore();
  const provinces = getProvinceNames();

  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gold-950 text-white shadow-xl mb-8">
      {/* Decorative Background Elements */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-brand-gold/20 blur-3xl opacity-50" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-80 h-80 rounded-full bg-brand-gold-700/30 blur-3xl opacity-50" />
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10 mix-blend-overlay" />
      </div>

      <div className="relative z-10 px-6 py-12 md:py-20 flex flex-col items-center justify-center text-center max-w-4xl mx-auto">
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold mb-4 tracking-tight">
          Welcome to the <span className="text-brand-gold-400">Digital Mall</span>
        </h1>
        <p className="text-brand-gold-100 text-lg md:text-xl mb-10 max-w-2xl text-balance">
          Discover verified premium storefronts, exclusive deals, and local businesses in a curated
          shopping experience.
        </p>

        {/* Integrated Search & Location Bar */}
        <div className="flex flex-col sm:flex-row w-full max-w-2xl bg-white/10 backdrop-blur-md border border-white/20 p-2 rounded-2xl shadow-2xl gap-2">
          {/* Location Selector */}
          <div className="relative flex-1 group">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-gold-200 group-focus-within:text-white transition-colors" />
            <select
              aria-label="Filter by Location"
              className="w-full h-12 lg:h-14 bg-white/5 hover:bg-white/10 text-white rounded-xl pl-11 pr-4 outline-none appearance-none transition-colors border border-transparent focus:border-brand-gold-400/50 cursor-pointer"
              value={filters.province || ""}
              onChange={(e) => setFilter("province", e.target.value || undefined)}
            >
              <option value="" className="text-foreground">
                All Provinces
              </option>
              {provinces.map((p) => (
                <option key={p} value={p} className="text-foreground">
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Keyword Search */}
          <div className="relative flex-1 sm:flex-[2] group hidden md:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-gold-200 group-focus-within:text-white transition-colors" />
            <input
              type="text"
              placeholder="Search shops or brands..."
              aria-label="Search shops or brands"
              value={filters.query || ""}
              onChange={(e) => setFilter("query", e.target.value || undefined)}
              className="w-full h-12 lg:h-14 bg-white/5 hover:bg-white/10 text-white placeholder:text-brand-gold-200/60 rounded-xl pl-11 pr-4 outline-none transition-colors border border-transparent focus:border-brand-gold-400/50"
            />
          </div>

          <button
            aria-label="Explore Mall Shops"
            className="h-12 lg:h-14 bg-brand-gold hover:bg-brand-gold-400 text-brand-gold-950 font-bold px-8 rounded-xl transition-all hover:scale-105 active:scale-95 shadow-lg flex items-center justify-center shrink-0"
          >
            Explore
          </button>
        </div>
      </div>
    </div>
  );
}
