import Link from "next/link";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { SponsorLink } from "@/components/organisations/sponsor-link";
import { SponsorLogo } from "@/components/organisations/sponsor-logo";
import { Button } from "@/components/ui/button";
import { getPublicSponsors } from "@/lib/organisations/sponsors";

const MAX_TILES = 8;

/**
 * "Backed by local organisations": a static row of programme partner logos.
 * No motion here (the Mzansi Business strip already moves). Not rendered
 * without an eligible sponsor.
 */
export async function HomeSponsorsSection() {
  const sponsors = (await getPublicSponsors()).filter((s) => s.on_home).slice(0, MAX_TILES);
  if (sponsors.length === 0) return null;

  return (
    <section aria-labelledby="home-sponsors-title" className="border-t border-border/60">
      <div className="container-page py-12 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-green-700 dark:text-brand-green-300">
            Programme partners
          </p>
          <h2 id="home-sponsors-title" className="section-title mt-2">
            Backed by local organisations
          </h2>
          <p className="section-lede">
            These organisations support local businesses on VerifyMzansi. Browse the businesses in
            their programmes.
          </p>
        </div>
        <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sponsors.map((sponsor) => (
            <li key={sponsor.id}>
              <SponsorLink
                href={`/organisation/${sponsor.slug}`}
                organisationId={sponsor.id}
                surface="sponsor_home"
                aria-label={`${sponsor.name} — view supported businesses`}
                className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-border/70 bg-card p-4 text-center elev-xs transition-[box-shadow,transform,border-color] duration-300 hover:border-brand-gold-400/50 hover:elev-md motion-safe:hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SponsorLogo src={sponsor.logo_url} name={sponsor.name} size={48} />
                <span className="line-clamp-2 text-sm font-semibold text-foreground">
                  {sponsor.name}
                </span>
              </SponsorLink>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="ink" className="h-11 rounded-full px-5">
            <Link href="/sponsors">See supported businesses</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 rounded-full px-5">
            <Link href="/advertise#programmes">Become a programme partner</Link>
          </Button>
        </div>
        <AnalyticsImpressions
          items={sponsors.map((sponsor) => ({ table: "organisations", id: sponsor.id }))}
          surface="sponsor_home"
        />
      </div>
    </section>
  );
}
