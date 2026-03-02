"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Building2 } from "lucide-react";
import { MallCard } from "@/components/listings/mall-card";
import { useMarketplaceStore } from "@/stores";
import { MALL_SHOP_CATEGORIES } from "@/lib/constants/categories";

type MallData = {
  id: string;
  name: string;
  location_province: string;
  location_city: string | null;
  cover_photo: string;
  storefronts: { status: string; category?: string; boost_until?: string | null }[];
};

export function MallShopsGrid() {
  const [malls, setMalls] = useState<MallData[]>([]);
  const [loading, setLoading] = useState(true);
  const { filters } = useMarketplaceStore();

  useEffect(() => {
    async function fetchMalls() {
      setLoading(true);
      const supabase = createClient();

      // Fetch malls that have at least one active storefront
      let query = supabase
        .from("malls")
        .select(
          `
          id,
          name,
          location_province,
          location_city,
          cover_photo,
          storefronts!inner (id, status, category, boost_until)
        `
        )
        .eq("storefronts.status", "live");

      // Apply location filters
      if (filters.province) {
        query = query.eq("location_province", filters.province);
      }
      if (filters.city) {
        query = query.eq("location_city", filters.city);
      }

      // Apply category filter on storefronts
      if (filters.category) {
        query = query.eq("storefronts.category", filters.category);
      }

      // Apply search query
      if (filters.query) {
        query = query.ilike("name", `%${filters.query}%`);
      }

      // Apply sort
      switch (filters.sort) {
        case "newest":
          query = query.order("created_at", { ascending: false });
          break;
        case "popular":
          query = query.order("name", { ascending: true });
          break;
        default:
          query = query.order("name", { ascending: true });
          break;
      }

      query = query.limit(18);

      const { data, error } = await query;

      if (!error && data) {
        setMalls(data);
      }
      setLoading(false);
    }

    fetchMalls();
  }, [filters.province, filters.city, filters.category, filters.sort, filters.query]);

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <div className="h-10 w-10 mx-auto border-4 border-brand-gold/30 border-t-brand-gold rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading malls...</p>
      </div>
    );
  }

  if (malls.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
        <p className="text-lg font-medium">
          {filters.province
            ? `No malls found in ${filters.city || filters.province}`
            : "No malls yet"}
        </p>
        <p className="text-sm text-muted-foreground">
          {filters.province
            ? "Try selecting a different area."
            : "Check back later to see malls with active shops."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {malls.map((mall, index) => {
        // We only want to count live storefronts.
        const liveShops = mall.storefronts.filter((s) => s.status === "live");
        const liveShopsCount = liveShops.length;

        // Check if any storefront in this mall is boosted
        const hasBoostedShop = liveShops.some(
          (s) => s.boost_until && new Date(s.boost_until) > new Date()
        );

        // Extract unique categories for preview
        const uniqueCategories = Array.from(new Set(liveShops.map((s) => s.category))).filter(
          Boolean
        ) as string[];

        // Map raw category values to friendly labels and take top 3
        const previewCategories = uniqueCategories
          .map(
            (cat) =>
              MALL_SHOP_CATEGORIES.find((c) => c.value === cat)?.label || cat.replace(/_/g, " ")
          )
          .slice(0, 3);

        return (
          <div
            key={mall.id}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms]"
            style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}
          >
            <MallCard
              id={mall.id}
              name={mall.name}
              coverPhoto={mall.cover_photo}
              province={mall.location_province}
              city={mall.location_city}
              shopCount={liveShopsCount}
              previewCategories={previewCategories}
              boosted={hasBoostedShop}
            />
          </div>
        );
      })}
    </div>
  );
}
