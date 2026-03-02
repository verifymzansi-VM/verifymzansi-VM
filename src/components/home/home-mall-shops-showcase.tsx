import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AreaPreviewCard } from "./area-preview-card";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMallShopsShowcase() {
  const supabase = await createClient();
  const { data: shops } = await supabase
    .from("storefronts")
    .select(
      "id, mall_name, cover_photo, location_province, location_city, description, boost_until"
    )
    .eq("status", "live")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const items = shops ?? [];
  if (items.length === 0) return null;

  return (
    <section className="py-6 sm:py-12 bg-brand-gold-50/30 dark:bg-brand-gold-950/20 border-y border-brand-gold-100 dark:border-brand-gold-900/50">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-brand-gold-900 dark:text-brand-gold-100">
              Explore Mall Shops
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Shop directly from digital storefronts of verified South African sellers.
            </p>
          </div>
          <Link href="/mall-shops" className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-gold-700 hover:text-brand-gold-700/80 transition-colors">
              Browse All Shops
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((s) => (
            <AreaPreviewCard
              key={s.id}
              href={`/mall-shops/${s.id}`}
              imageUrl={s.cover_photo}
              title={s.mall_name}
              description={s.description}
              city={s.location_city ?? "South Africa"}
              provinceCode={provinceCode(s.location_province ?? "ZA")}
              accentColor="gold"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
