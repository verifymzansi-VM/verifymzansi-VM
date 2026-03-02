"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Briefcase } from "lucide-react";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { BusinessAdCard } from "@/components/listings/business-ad-card";
import { useMarketplaceStore } from "@/stores";

type BusinessData = {
  id: string;
  business_name: string;
  about: string | null;
  cover_photo: string | null;
  cover_video: string | null;
  logo_url: string | null;
  category: string;
  services_offered: string[] | null;
  website: string | null;
  seller_id: string;
  boost_until: string | null;
};

export function BusinessAdsGrid() {
  const [businesses, setBusinesses] = useState<BusinessData[]>([]);
  const [sellers, setSellers] = useState<
    Map<string, { display_name: string; seller_verification_status: string }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const { filters } = useMarketplaceStore();

  useEffect(() => {
    async function fetchBusinesses() {
      setLoading(true);
      const supabase = createClient();

      let query = supabase
        .from("business_profiles")
        .select(
          `id, business_name, about, cover_photo, cover_video, logo_url,
           category, services_offered, website, seller_id, boost_until`
        )
        .eq("status", "live");

      // Apply category filter
      if (filters.category) {
        query = query.eq("category", filters.category);
      }

      // Apply search query
      if (filters.query) {
        query = query.or(`business_name.ilike.%${filters.query}%,about.ilike.%${filters.query}%`);
      }

      // Apply sort
      switch (filters.sort) {
        case "popular":
          query = query
            .order("boost_until", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });
          break;
        case "price_asc":
        case "price_desc":
          // Business profiles don't have price; fall through to newest
          query = query.order("created_at", { ascending: false });
          break;
        case "newest":
        default:
          query = query
            .order("boost_until", { ascending: false, nullsFirst: false })
            .order("created_at", { ascending: false });
          break;
      }

      query = query.limit(18);

      const { data, error } = await query;

      if (error || !data?.length) {
        setBusinesses([]);
        setLoading(false);
        return;
      }

      setBusinesses(data);

      // Fetch seller profiles in batch
      const sellerIds = Array.from(
        new Set(data.map((b: { seller_id: string }) => b.seller_id).filter(Boolean))
      );
      if (sellerIds.length > 0) {
        const { data: sellerData } = await supabase
          .from("seller_profiles")
          .select("user_id, display_name, seller_verification_status")
          .in("user_id", sellerIds);

        const map = new Map<string, { display_name: string; seller_verification_status: string }>(
          (sellerData ?? []).map(
            (s: { user_id: string; display_name: string; seller_verification_status: string }) => [
              s.user_id,
              s,
            ]
          )
        );
        setSellers(map);
      }

      setLoading(false);
    }

    fetchBusinesses();
  }, [filters.category, filters.sort, filters.query]);

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <div className="h-10 w-10 mx-auto border-4 border-sky-600/30 border-t-sky-600 rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Loading businesses...</p>
      </div>
    );
  }

  if (businesses.length === 0) {
    return (
      <div className="text-center py-16 space-y-3">
        <Briefcase className="h-10 w-10 mx-auto text-muted-foreground" />
        <p className="text-lg font-medium">
          {filters.category || filters.query
            ? "No businesses match your filters"
            : "No businesses yet"}
        </p>
        <p className="text-sm text-muted-foreground">
          {filters.category || filters.query
            ? "Try adjusting your search or category filter."
            : "Create a verified business profile to appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {businesses.map((biz, index) => {
        const seller = sellers.get(biz.seller_id);
        const trustLevel = computeTrustLevel(
          (seller?.seller_verification_status as "incomplete" | "pending_review" | "verified") ??
            "incomplete"
        );
        const isBoosted = biz.boost_until ? new Date(biz.boost_until) > new Date() : false;

        return (
          <div
            key={biz.id}
            className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms]"
            style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}
          >
            <BusinessAdCard
              id={biz.id}
              name={biz.business_name}
              about={biz.about || undefined}
              logoUrl={biz.logo_url}
              coverUrl={biz.cover_video || biz.cover_photo}
              servicesOffered={biz.services_offered || undefined}
              website={biz.website}
              trustLevel={trustLevel}
              sellerName={seller?.display_name || undefined}
              category={biz.category}
              boosted={isBoosted}
            />
          </div>
        );
      })}
    </div>
  );
}
