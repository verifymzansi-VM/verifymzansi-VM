import Link from "next/link";
import { restoredProgrammeShowcases } from "@/lib/foundation/marketplace-server";
import { foundationMediaUrl } from "@/lib/foundation/public-cards";
import { Landmark } from "lucide-react";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { PosterCardShell } from "@/components/listings/poster-card-shell";

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
  const visible = (await restoredProgrammeShowcases(placement)).map((section) => ({
    showcase: {
      id: section.id,
      title: section.title,
      organisations: { slug: section.organisation_slug, name: section.organisation_name },
    },
    rows: section.cards.map((card) => ({
      business_id: card.post_id,
      business_name: card.title ?? "Business",
      city: card.city,
      cover_image: foundationMediaUrl(card.cover_object_key),
      logo_url: null,
    })),
  }));
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
                  Sponsor spotlight
                </p>
                <h2 id={`programme-${showcase.id}`} className="font-display text-xl font-semibold">
                  {showcase.title}
                </h2>
              </div>
              <Link
                href={`/organisation/${showcase.organisations!.slug}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center text-sm font-semibold underline"
              >
                View all
                <span className="sr-only"> {showcase.organisations!.name} businesses</span>
              </Link>
            </div>
            <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:gap-4 sm:px-0">
              {rows.map((row) => (
                <li key={row.business_id} className="w-[44%] shrink-0 snap-start sm:w-[238px]">
                  {/* Same full-bleed 9:16 card as every other rail. */}
                  <PosterCardShell
                    immersive
                    href={`/mzansi-business/${row.business_id}`}
                    title={row.business_name}
                    mediaUrl={row.cover_image ?? row.logo_url ?? undefined}
                    mediaAlt={row.business_name}
                    logoUrl={row.cover_image ? (row.logo_url ?? undefined) : undefined}
                    location={row.city}
                    cardVariant="showcase"
                  />
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
