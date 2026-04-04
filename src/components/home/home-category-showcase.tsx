import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Building2, TreePalm, ShoppingBag, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { AutoScrollRail } from "./auto-scroll-rail";

interface CategoryInfo {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accentColor: string;
  accentBg: string;
  count: number;
  thumbnailUrl: string | undefined;
}

export async function HomeCategoryShowcase() {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [marketResult, businessResult, promoResult, tourismResult] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, description, photos", { count: "exact" })
      .eq("status", "live")
      .eq("area", "MZANSI_MARKET")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("businesses")
      .select("id, business_name, description, cover_photo", { count: "exact" })
      .eq("status", "live")
      .eq("area", "MZANSI_BUSINESS")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("promotions")
      .select("id, title, description, photos", { count: "exact" })
      .eq("status", "live")
      .eq("promotion_type", "event")
      .or(`end_date.is.null,end_date.gte.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("businesses")
      .select("id", { count: "exact" })
      .eq("status", "active")
      .eq("category", "tourism_hospitality")
      .limit(0),
  ]);

  // Find first non-placeholder item thumbnail for each category
  const marketItems = (marketResult.data ?? []).filter(
    (i) => !isPlaceholderMarketplaceContent(i.title, i.description)
  );
  const businessItems = (businessResult.data ?? []).filter(
    (i) => !isPlaceholderMarketplaceContent(i.business_name, i.description)
  );
  const promoItems = (promoResult.data ?? []).filter(
    (i) => !isPlaceholderMarketplaceContent(i.title, i.description)
  );
  const promoRemovedCount = (promoResult.data ?? []).length - promoItems.length;
  const promoCount = Math.max(0, (promoResult.count ?? promoItems.length) - promoRemovedCount);
  const tourismCount = tourismResult.count ?? 0;
  const tourismEventsCount = promoCount + tourismCount;

  const marketThumb = marketItems[0]?.photos?.[0];
  const businessThumb = businessItems[0]?.cover_photo;
  const promoThumb = promoItems[0]?.photos?.[0];

  const categories: CategoryInfo[] = [
    {
      title: "Mzansi Business",
      description: "Find trusted businesses or create a profile for your services.",
      href: "/mzansi-business",
      icon: Building2,
      accentColor: "text-brand-blue",
      accentBg: "bg-brand-blue/10",
      count: businessResult.count ?? 0,
      thumbnailUrl: businessThumb ? normalizeMediaUrl(businessThumb) : undefined,
    },
    {
      title: "Mzansi Market",
      description: "Browse or post verified listings for everyday buying and selling.",
      href: "/mzansi-market",
      icon: ShoppingBag,
      accentColor: "text-brand-green",
      accentBg: "bg-brand-green/10",
      count: marketResult.count ?? 0,
      thumbnailUrl: marketThumb ? normalizeMediaUrl(marketThumb) : undefined,
    },
    {
      title: "Tourism & Events",
      description: "Discover tourism destinations, accommodations, and events near you.",
      href: "/promotions",
      icon: TreePalm,
      accentColor: "text-teal-500",
      accentBg: "bg-teal-500/10",
      count: tourismEventsCount,
      thumbnailUrl: promoThumb ? normalizeMediaUrl(promoThumb) : undefined,
    },
  ];

  if (categories.every((c) => c.count === 0)) return null;

  return (
    <section className="py-4 sm:py-6 bg-gradient-to-b from-warm-50/50 to-white dark:from-warm-950/30 dark:to-warm-950">
      <div className="container-page space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl sm:text-2xl font-bold">Explore VerifyMzansi</h2>
        </div>

        <AutoScrollRail ariaLabel="Browse categories">
          {categories.map((cat) => (
            <div
              key={cat.title}
              className="min-w-[280px] max-w-[400px] sm:min-w-[360px] sm:max-w-[420px]"
            >
              <CategoryCard category={cat} />
            </div>
          ))}
        </AutoScrollRail>
      </div>
    </section>
  );
}

function CategoryCard({ category }: { category: CategoryInfo }) {
  const Icon = category.icon;

  return (
    <Link
      href={category.href}
      className="group block w-full rounded-2xl overflow-hidden border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
    >
      {/* Thumbnail */}
      <div className="relative aspect-[16/9] overflow-hidden bg-warm-100 dark:bg-warm-800">
        {category.thumbnailUrl ? (
          <Image
            src={category.thumbnailUrl}
            alt={category.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 80vw, 340px"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Icon className={`h-16 w-16 ${category.accentColor} opacity-20`} />
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />

        {/* Icon badge */}
        <div className="absolute top-3 left-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white/90 dark:bg-warm-900/90 backdrop-blur-sm ${category.accentColor}`}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>

        {/* Count badge */}
        {category.count > 0 && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center rounded-full bg-white/90 dark:bg-warm-900/90 backdrop-blur-sm px-2.5 py-0.5 text-xs font-semibold text-warm-700 dark:text-warm-200">
              {category.count} {category.count === 1 ? "listing" : "listings"}
            </span>
          </div>
        )}

        {/* Title overlay */}
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="text-lg font-bold text-white drop-shadow-sm">{category.title}</h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-2">
        <p className="text-sm text-muted-foreground line-clamp-2">{category.description}</p>
        <span
          className={`inline-flex items-center gap-1 text-sm font-medium ${category.accentColor} group-hover:underline`}
        >
          View All
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
