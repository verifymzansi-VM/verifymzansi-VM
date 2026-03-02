import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AreaPreviewCard } from "./area-preview-card";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeBusinessShowcase() {
  const supabase = await createClient();
  const { data: businesses } = await supabase
    .from("businesses")
    .select(
      "id, business_name, cover_photo, location_province, location_city, description, boost_until, business_type"
    )
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const items = businesses ?? [];
  if (items.length === 0) return null;

  return (
    <section className="py-6 sm:py-12 bg-blue-50/30 dark:bg-blue-950/20 border-y border-blue-100 dark:border-blue-900/50">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-blue-900 dark:text-blue-100">
              Mzansi Business
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Discover verified South African businesses — shops, services, and more.
            </p>
          </div>
          <Link href="/mzansi-business" className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue hover:text-brand-blue/80 transition-colors">
              Browse All Businesses
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {items.map((b) => (
            <AreaPreviewCard
              key={b.id}
              href={`/mzansi-business/${b.id}`}
              imageUrl={b.cover_photo}
              title={b.business_name}
              description={b.description}
              city={b.location_city ?? "South Africa"}
              provinceCode={provinceCode(b.location_province ?? "ZA")}
              accentColor="blue"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
