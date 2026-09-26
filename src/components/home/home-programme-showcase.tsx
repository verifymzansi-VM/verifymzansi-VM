import Image from "next/image";
import Link from "next/link";
import { Building2, Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveCommercialSettings } from "@/lib/commercial/settings";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { BUSINESS_CATEGORY_LABELS, type BusinessCategory } from "@/types/enums";

interface Showcase {
  id: string;
  title: string;
  max_cards: number;
  city: string | null;
  sponsored_only: boolean;
  organisations: { id: string; slug: string; name: string } | null;
}

interface DirectoryRow {
  business_id: string;
  business_name: string;
  category: string | null;
  city: string | null;
  logo_url: string | null;
  cover_image: string | null;
  sponsored: boolean;
}

/**
 * Optional programme spotlights configured by VerifyMzansi admins. Separate
 * from organic ranking and the main showroom; hidden unless there is enough
 * quality content.
 */
export async function HomeProgrammeShowcase({
  placement = "home",
}: {
  placement?: "home" | "business" | "tourism" | "market";
}) {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [{ data: showcases }, { data: settingsRows }] = await Promise.all([
    supabase
      .from("programme_showcases")
      .select("id, title, max_cards, city, sponsored_only, organisations(id, slug, name)")
      .eq("enabled", true)
      .eq("placement", placement)
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("display_order")
      .limit(2),
    supabase.from("commercial_settings").select("key, value").in("key", ["showroom", "features"]),
  ]);
  if (!showcases?.length) return null;
  const settings = resolveCommercialSettings(settingsRows);
  if (!settings.features.organisationsPublic) return null;
  const minItems = settings.showroom.programmeMinItems;

  const sections = await Promise.all(
    (showcases as unknown as Showcase[]).map(async (showcase) => {
      if (!showcase.organisations) return null;
      const { data } = await supabase.rpc("organisation_directory", {
        p_org: showcase.organisations.id,
        p_city: showcase.city,
        p_sponsored: showcase.sponsored_only ? true : null,
        p_limit: Math.min(showcase.max_cards, settings.showroom.programmeMaxCards),
        p_offset: 0,
      });
      const rows = ((data ?? []) as DirectoryRow[]).filter(
        (row) => row.cover_image || row.logo_url
      );
      return rows.length >= minItems ? { showcase, rows } : null;
    })
  );

  const visible = sections.filter(
    (section): section is NonNullable<typeof section> => section !== null
  );
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map(({ showcase, rows }) => (
        <section
          key={showcase.id}
          aria-labelledby={`programme-${showcase.id}`}
          className="py-8 sm:py-10"
        >
          <div className="container-page space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Landmark aria-hidden="true" className="h-3.5 w-3.5" />
                  Programme spotlight
                </p>
                <h2 id={`programme-${showcase.id}`} className="font-display text-xl font-semibold">
                  {showcase.title}
                </h2>
              </div>
              <Link
                href={`/organisation/${showcase.organisations!.slug}`}
                className="text-sm underline"
              >
                View all
              </Link>
            </div>
            <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              {rows.map((row) => (
                <li key={row.business_id} className="w-60 shrink-0 snap-start">
                  <Link
                    href={`/mzansi-business/${row.business_id}`}
                    className="surface-card block h-full overflow-hidden transition-shadow hover:elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="relative block aspect-[4/3] bg-muted">
                      {row.cover_image ? (
                        <Image
                          src={row.cover_image}
                          alt=""
                          fill
                          sizes="240px"
                          className="object-contain"
                          unoptimized
                        />
                      ) : (
                        <Building2
                          aria-hidden="true"
                          className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground"
                        />
                      )}
                    </span>
                    <span className="block space-y-0.5 p-3">
                      <span className="block truncate font-semibold">{row.business_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {BUSINESS_CATEGORY_LABELS[row.category as BusinessCategory] ?? "Business"}
                        {row.city ? ` · ${row.city}` : ""}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {row.sponsored
                          ? `Supported by ${showcase.organisations!.name}`
                          : `Participant — ${showcase.organisations!.name}`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <AnalyticsImpressions
              items={rows.map((row) => ({ table: "businesses" as const, id: row.business_id }))}
              type="showroom_appearance"
              surface={`programme:${placement}`}
            />
          </div>
        </section>
      ))}
    </>
  );
}
