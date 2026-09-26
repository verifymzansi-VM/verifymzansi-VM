import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Building2, ShoppingBag, TreePalm } from "lucide-react";
import { cn } from "@/lib/utils";

const GATEWAYS = [
  {
    href: "/mzansi-market",
    title: "Mzansi Market",
    tagline: "Buy & sell locally",
    image: "/images/showrooms/market-v2-mobile.avif",
    icon: ShoppingBag,
    accent: "bg-brand-green-600",
    chip: "text-brand-green-700",
  },
  {
    href: "/mzansi-business",
    title: "Mzansi Business",
    tagline: "Hire & support local",
    image: "/images/showrooms/business-v2-mobile.avif",
    icon: Building2,
    accent: "bg-brand-blue-600",
    chip: "text-brand-blue-700",
  },
  {
    href: "/tourism-events",
    title: "Tourism & Events",
    tagline: "Stay, explore & go out",
    image: "/images/showrooms/tourism-v2-mobile.avif",
    icon: TreePalm,
    accent: "bg-sunset-600",
    chip: "text-sunset-700",
  },
] as const;

/**
 * The three product areas as large, photographic entry points. Server-rendered
 * links so visitors and crawlers get the same stable primary navigation.
 */
export function HomeCategoryGateways() {
  return (
    <nav aria-label="VerifyMzansi primary categories" className="container-page py-10 sm:py-14">
      <h2 className="section-title mb-5">Explore Mzansi</h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0">
        {GATEWAYS.map((gateway) => {
          const Icon = gateway.icon;
          return (
            <li key={gateway.href} className="w-[78%] shrink-0 snap-start sm:w-auto">
              <Link
                href={gateway.href}
                prefetch={false}
                className="group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-3xl bg-slate-900 text-white shadow-md ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:aspect-[4/5] lg:aspect-[5/6]"
              >
                <Image
                  src={gateway.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 78vw, 33vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/5"
                />
                <span
                  className={cn(
                    "absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold shadow-sm",
                    gateway.chip
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {gateway.tagline}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors group-hover:bg-white group-hover:text-foreground"
                >
                  <ArrowUpRight className="h-4 w-4" />
                </span>
                <span className="relative p-5 sm:p-6">
                  <span className={cn("mb-3 block h-1 w-10 rounded-full", gateway.accent)} />
                  <span className="block font-display text-2xl font-bold tracking-tight">
                    {gateway.title}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
